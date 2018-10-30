/* ----------------------------------------------------------------------------
* A server that accepts HTTP POST requests with the following information in 
* the request bodies, URL-encoded and in the form of a HTTP query string, and
* send them as emails via the email service providers Mailgun or Sendgrid.
* 
* -   from:       sender's email address
* -   to:         recipient's email address
* -   cc:         email address to CC to
* -   bcc:        email address to BCC to
* -   subject:    subject, in plain text
* -   text:       message, in plain text
* 
* "from", "to", "subject" and "text" are mandatory.
* Multiple "to"'s are allowed.
* Zero or more "cc"'s and "bcc"'s are allowed.
------------------------------------------------------------------------------*/

"use strict";

const server = require( "express" )();
const bodyParser = require( "body-parser" );// to parse POST body
const morgan = require( "morgan" );         // for access log
const winston = require( "winston" );       // for message log
const fs = require( "fs" );
const path = require( "path" );
const httpCode = require( "http-codes" );
const emailAddrParser = require( "email-addresses" );
const mailer = require( "./mailer" );

// Mailgun and Sendgrid need to source some mandatory parameters from 
// environment variables.
const mailerError = mailer.init();
if( mailerError ) {
    console.log( mailerError );
    process.exit( 1 );
}

// Following parameters are configurable via environment variables.
const PORT = process.env.EMAIL_PORT || 8080;
const LOG_DIR = process.env.EMAIL_LOG_DIR || __dirname;
const LOG_LEVEL = process.env.EMAIL_LOG_LEVEL || "info";

// Make sure log directory exists.
fs.existsSync( LOG_DIR ) || fs.mkdirSync( LOG_DIR );

// Parse application/x-www-form-urlencoded in request body.
server.use( bodyParser.urlencoded({ extended: false }))

// Log HTTP requests to a standard Apache common access log.
const accessLogName = path.join( LOG_DIR, "access.log" );
const accessLog = fs.createWriteStream( accessLogName, { flags: "a" });
server.use( morgan( "common", { stream: accessLog }));

// Log runtime messages to a file.
const { File } = winston.transports;
const { printf, timestamp, combine } = winston.format;
const msgLog = path.join( LOG_DIR, "message.log" );
const msgFmt = printf( x => `${x.timestamp} ${x.level} ${x.message}` );
const logger = winston.createLogger({
    format: combine( timestamp(), msgFmt )
,   transports: [ new File({ level: LOG_LEVEL, filename: msgLog })]
});

// Only acceptable request is POST /mail HTTP/1.x.
server.post( "/mail", function ( req, res ) {
    handleMail( req, res );
});

// Anything else is invalid.
server.use( function( req, res, next ) {
    logger.error( "Page " + req.url + " not found" );
    res.status( 404 ).send( "This page does not exist!" );
});

// Start server ...
server.listen( PORT, function() {
    logger.info( "Email Service listening on port " + PORT );
});

// Handle POST /mail with URL-encoded query string in request body.
function handleMail( req, res )
{
    try {

        // Assemble a mail object from req.
        const { error, mail } = assembleMail( req );
        if( error ) {
            logger.error( "Can't send mail received - bad request" );
            res.status( httpCode.BAD_REQUEST );
            res.end( error );
            return;
        }

        // Send a mail through a email service provider.
        mailer.send( mail, ( err ) => {
            try {
                if( err ) {
                    if( err.code !== httpCode.BAD_REQUEST ) {
                        internalError( res, err );
                    } else {
                        logger.error( "Can't send mail received - bad request" );
                        res.status( httpCode.BAD_REQUEST );
                        res.end( err.message );
                    }
                } else {
                    logger.info( "Sending mail received via a service provider" );
                    res.status( httpCode.OK );
                    res.end();
                }
            } catch( err ) {
                internalError( res, err );
            }
        });

    } catch( err ) {
        internalError( res, err );
    }
}

// Assemble a mail object from a HTTP request.
function assembleMail( req )
{
    const body = req.body;
    if( !body ) return { error: "Missing entire email" };

    let from = trim( body.from );
    let to = trim( body.to );
    let cc = trim( body.cc );
    let bcc = trim( body.bcc );
    let subject = trim( body.subject );
    let text = trim( body.text );

    // Check mandatory fields.
    if( !from ) return { error: 'Missing or empty "from" field' };
    if( !to ) return { error: 'Missing or empty "to" field' };
    if( !subject ) return { error: 'Missing or empty "subject" field' };
    if( !text ) return { error: 'Missing or empty "text" field' };

    // Check "from" field for correct email address format.
    let ok;
    ({ ok, addr: from } = parseEmailAddr( from, true, true ));
    if( !ok ) return { error: 'Invalid "from" field' };

    // Check "to" field for correct email address format.
    ({ ok, addr: to } = parseEmailAddr( to, true ));
    if( !ok ) return { error: 'Invalid "to" field' };

    // Check "cc" field for correct email address format.
    ({ ok, addr: cc } = parseEmailAddr( cc, false ));
    if( !ok ) return { error: 'Invalid "cc" field' };

    // Check "bcc" field for correct email address format.
    ({ ok, addr: bcc } = parseEmailAddr( bcc, false ));
    if( !ok ) return { error: 'Invalid "bcc" field' };

    // Return a mail object assembled from the HTTP request.
    const mail =
    {
        from:       from
    ,   to:         to
    ,   cc:         cc
    ,   bcc:        bcc
    ,   subject:    subject
    ,   text:       text
    };
    return { mail: mail };
}

// Parse one or more email addresses in a string into an array of email 
// addresses of 2 attributes - name and address.
function parseEmailAddr( addr, required, single )
{
    // Take care of null address first.
    if( !addr ) return { ok: !required };

    // Otherwise address must be a string.
    if( typeof addr !== "string" ) return { ok: false };

    // Validate address by putting it through an address parser.
    const arr = emailAddrParser.parseAddressList( addr );
    if( !arr ) {
        logger.error( 'Email address "' + addr + '" is invalid' );
        return { ok: false };
    }
    if( single ) {
        if( arr.length !== 1 ) {
            logger.error( 'Email address "' + addr + '" is invalid' );
            return { ok: false };
        }
        const r0 = arr[ 0 ];
        return { ok: true, addr: { name: r0.name, addr: r0.address }};
    }
    return { ok: true, addr: arr.map( x => ({ name: x.name, addr: x.address }))};
}

// Tell client there is an internal error.
function internalError( res, err )
{
    res.status( httpCode.INTERNAL_SERVER_ERROR );
    res.end( "There is an problem at our end. We will fix it ASAP." );
    logger.error( err.message );
    logger.error( err.stack );
}

// Trim the given string parameter.
function trim( s )
{
    return s ? s.trim(): s;
}
