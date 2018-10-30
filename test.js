/* ----------------------------------------------------------------------------
 * 3 test cases:
 * a) Test requests with bad parameters
 * b) Test sending emails via Mailgun
 * c) Test sending emails via Sendgrid
 * Use test.sh instead of this script because test.sh sets the appropriate 
 * environment variables to test either Mailgun or Sendgrid
 * ------------------------------------------------------------------------- */

"use strict";

const http = require( "http" );
const queryStr = require( "querystring" );
const test = require( "tape" );
const { OK, BAD_REQUEST } = require( "http-codes" );

/*
* usage: node test ( bad-params | mailgun | sendgrid )
*/
if( process.argv.length !== 3 ) process.exit( 0 );
const testCase = process.argv[ 2 ].toLowerCase()
if( testCase === "bad-params" )
    testBadParams()
else if( testCase === "mailgun" )
    testServiceProvider( "Mailgun" )
else if( testCase === "sendgrid" )
    testServiceProvider( "Sendgrid" )

/* 
*  Test requests with bad parameters.
*/
function testBadParams()
{
    test( "Test requests with bad parameters", ( t ) => {
        t.plan( 5 );
        noMail( t, () => {
            noFromField( t, () => {
                noToField( t, () => {
                    noSubjectField( t, () => {
                        noTextField( t );
                    });
                });
            });
        });
    });
}

/*
* Test a service provider
*/
function testServiceProvider( provider )
{
    test( "Test sending a request through " + provider, ( t ) => {
        t.plan( 3 );
        noCcNoBcc( t, provider, () => {
            noBcc( t, provider, () => {
                noCc( t, provider );
            });
        });
    });
}

// A good email.
const addr1 = "hoolam.woon@outlook.com";
const addr2 = "hoolam.woon@bi.nu";
const addr3 = "hoolie2468@outlook.com";
const goodMail = makeMail
( 
    addr1
,   [ addr2 ]
,   [ addr3 ]
,   [ addr3 ]
,   "Testing Simple Email Backend"
,   "This is an email sent by the Simple Email Backend"
);

function noMail( t, next )
{
    post( null, BAD_REQUEST, 'Expecting BAD_REQUEST for empty mail', t, next );
}

function noFromField( t, next )
{
    let m = deepCopy( goodMail );
    delete m.from;
    post( m, BAD_REQUEST, 'Expecting BAD_REQUEST for mail missing "from" field', t, next );
}

function noToField( t, next )
{
    let m = deepCopy( goodMail );
    delete m.to;
    post( m, BAD_REQUEST, 'Expecting BAD_REQUEST for mail missing "to" field', t, next );
}

function noSubjectField( t, next )
{
    let m = deepCopy( goodMail );
    delete m.subject;
    post( m, BAD_REQUEST, 'Expecting BAD_REQUEST for mail missing "subject" field', t, next );
}

function noTextField( t, next )
{
    let m = deepCopy( goodMail );
    delete m.text;
    post( m, BAD_REQUEST, 'Expecting BAD_REQUEST for mail missing "text" field', t, next );
}

function noCcNoBcc( t, provider, next )
{
    const context = " via " + provider + " without CC and BCC";
    let m = deepCopy( goodMail );
    delete m.cc;
    delete m.bcc;
    m.text = m.text + context;
    post( m, OK, "Expecting OK for mail sent " + context, t, next );
}

function noCc( t, provider, next )
{
    // Delay test because service provider imposes a rate limit on free account
    setTimeout(() => {
        const context = " via " + provider + " with BCC but no CC";
        let m = deepCopy( goodMail );
        delete m.cc;
        m.text = m.text + context;
        post( m, OK, "Expecting OK for mail sent " + context, t, next );
    }, 2000 );
}

function noBcc( t, provider, next )
{
    // Delay test because service provider imposes a rate limit on free account
    setTimeout(() => {
        const context = " via " + provider + " with CC but no BCC";
        let m = deepCopy( goodMail );
        delete m.bcc;
        m.text = m.text + context;
        post( m, OK, "Expecting OK for mail sent " + context, t, next );
    }, 2000 );
}

// A helper function to POST a HTTP request.
function post( mail, expectedHttpCode, msg, t, next )
{
    const body = queryStr.stringify( mail );
    const headers =
    { 
        "Content-Type": "application/x-www-form-urlencoded" 
    ,   "Content-Length": body.length
    };

    const req = http.request
    ({
        hostname:   "localhost"
    ,   port:       8080
    ,   path:       "/mail"
    ,   method:     "POST"
    ,   headers:    headers
    ,   timeout:    10000
    });

    req.once( "response", ( res ) => {
        try {
            req.removeAllListeners();
            t.equal( res.statusCode, expectedHttpCode, msg );
        } catch( err ) {
            t.fail( err.message );
        }
        if( next ) next();
    });

    req.once( "error", ( err ) => {
        // Not wrapping in try-catch because it's trivially simple
        t.fail( err );
        req.abort();
        req.removeAllListeners();
    });

    // When an idle timeout is triggered the socket will receive a 'timeout' event
    // but the connection will not be severed. The user must manually call the 
    // following to end the connection.
    // socket.end (half close - still writeable), or 
    // socket.destroy (full close - no further IO), or
    // socket.abort (drop remaining data in the response and destroy the socket)
    req.once( "timeout", () => {
        // Not wrapping in try-catch because it's trivially simple and callback 
        // is catching its own exceptions.
        t.fail( "timeout" );
        req.abort();
        req.removeAllListeners();
    });
    
    if( body ) req.write( body );
    req.end();
}

function makeError( code, msg )
{
    const err = new Error( msg );
    err.code = code;
    return err;
}

function makeMail( from, to, cc, bcc, subject, text )
{
    const mail = {};
    if( from !== null || from !== undefined ) mail.from = from;
    if( to !== null || to !== undefined ) mail.to = to;
    if( cc !== null || cc !== undefined ) mail.cc = cc;
    if( bcc !== null || bcc !== undefined ) mail.bcc = bcc;
    if( subject !== null || subject !== undefined ) mail.subject = subject;
    if( text !== null || text !== undefined ) mail.text = text;
    return mail;
}

function deepCopy( x )
{
    return JSON.parse( JSON.stringify( x ))
}
