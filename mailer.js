/*-----------------------------------------------------------------------------
* A module that allows callers to send emails via the service providers 
* Mailgun and Sendgrid. We start off with the 1st provider. When a chosen 
* provider fails, we move on to the next provider.
* This is a very simple approach. The downside is if all providers fail at 
* same time, all requests would fail as well. 
-----------------------------------------------------------------------------*/

"use strict";

const https = require( "https" );
const httpCode = require( "http-codes" );
const qryStr = require( "querystring" );
const FormData = require( "form-data" );

// ----------------------------------------------------------------------------
// Caller to invoke the following function to set up service providers.
// ----------------------------------------------------------------------------

exports.init = initProviders;

// ----------------------------------------------------------------------------
// Allow caller to send an email
// Note that the input parameter "mail" has already been validated by the 
// caller.
// Caller is to wrap call in try-catch so exceptions don't escape.
// ----------------------------------------------------------------------------

exports.send = function( mail, callback )
{
    // Get a service provider.
    const provider = getProvider();
    if( !provider ) {
        callback( makeError( httpCode.SERVICE_UNAVAILABLE, "No email service provider" ));
        return;
    }

    // Send mail through the chosen service provider.
    provider.send( mail, ( err ) => {
        if( !err ) {
            callback();
            return;
        }
        callback( err );
        useNextProvider(); // current service provider is erring, so use next one
    });
}

// Helper function to create an error object to pass back to this module's caller.
function makeError( code, msg )
{
    const err = new Error( msg );
    err.code = code;
    return err;
}

// ----------------------------------------------------------------------------
// An https.Agent is responsible for managing connection persistence and 
// reuse for HTTPS clients. It maintains a queue of pending requests 
// for a given host and port, reusing a single socket connection for 
// each until the queue is empty, at which time the socket is either 
// destroyed or put into a pool where it is kept to be used again 
// for requests to the same host and port. Whether it is destroyed 
// or pooled depends on the keepAlive option.
// ----------------------------------------------------------------------------

const MAX_SOCKS_PER_HOST = 3;

const httpsAgent = new https.Agent({ 
    keepAlive: true
,   maxSockets:  MAX_SOCKS_PER_HOST
});

// ----------------------------------------------------------------------------
// Constructor for an email service provider.
// this.makeReq is function( mail ) and each instance must provide an 
// implementation to create a request suitable for sending a mail to its 
// service provider.
// ----------------------------------------------------------------------------

function Provider( name, makeReq )
{
    this.name = name;
    this.makeReq = makeReq;
}

// A send function inherited by each service provider.
Provider.prototype.send = function( mail, callback )
{
    const{ req, body } = this.makeReq( mail );

    req.once( "response", ( res ) => {
        try {
            req.removeAllListeners();
            if( res.statusCode === httpCode.OK 
            ||  res.statusCode === httpCode.ACCEPTED ) {
                callback();
            } else if( res.statusCode === httpCode.BAD_REQUEST ) {
                callback( makeError( httpCode.BAD_REQUEST, res.statusMessage ));
            } else {
                const msg = this.name + " error - " + res.statusMessage;
                callback( makeError( httpCode.INTERNAL_SERVER_ERROR, msg ));
            }
        } catch( err ) {
            callback( makeError( httpCode.INTERNAL_SERVER_ERROR, err.message ));
        }
    });

    req.once( "error", ( err ) => {
        // Not wrapping in try-catch because it's trivially simple and callback 
        // is catching its own exceptions.
        callback( makeError( httpCode.INTERNAL_SERVER_ERROR, err.message ));
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
        callback( makeError( httpCode.INTERNAL_SERVER_ERROR, "timeout" ));
        req.abort();
        req.removeAllListeners();
    });
    
    if( body ) {
        req.write( body );
        req.end();
    }
}

// ----------------------------------------------------------------------------
// Mailgun is a email service provider.
// Emails are sent by POST'ing a percent-encoded query string to 
// https://api.mailgun.net/v3/DOMAIN/messages
// ----------------------------------------------------------------------------

let mailgunApiKey;  // API key
let mailgunDomain;  // all emails sent are associated with this domain name
let mailgunAuth;    // used to create a Authorization header

const mailgun = new Provider(

    "Mailgun"

,   function( mail )
    {
        // Create a form about the email to be sent.
        const form = new FormData();
        form.append( "from", mail.from.addr );
        form.append( "subject", mail.subject );
        form.append( "text", mail.text );
        mail.to.forEach(( x ) => { form.append( "to", x.addr ); });
        if( mail.cc ) mail.cc.forEach(( x ) => { form.append( "cc", x.addr ); });
        if( mail.bcc ) mail.bcc.forEach(( x ) => { form.append( "bcc", x.addr ); });

        // Create the HTTP request to Mailgun.
        const headers = form.getHeaders();
        headers[ "Content-Length" ] = form.getLengthSync();
        const req = https.request
        ({
            hostname:   "api.mailgun.net"
        ,   path:       "/v3/" + mailgunDomain + "/messages"
        ,   method:     "POST"
        ,   auth:       mailgunAuth
        ,   timeout:    15000
        ,   headers:    headers
        ,   agent:      httpsAgent
        });

        // Append the form to the request, so it becomes the request body
        form.pipe( req );

        return { req: req };
    }
);

// ----------------------------------------------------------------------------
// Sendgrid is a email service provider.
// Emails are sent by POST'ing a JSON to https://api.sendgrid.com/v3/mail/send
// ----------------------------------------------------------------------------

let sendgridApiKey; // API key
let sendgridAuth;   // value of Authorization header

const sendgrid = new Provider(

    "SendGrid"

,   function( mail )
    {
        const req = https.request
        ({
            hostname:   "api.sendgrid.com"
        ,   path:       "/v3/mail/send"
        ,   method:     "POST"
        ,   headers:    { "Content-Type": "application/json", "Authorization": sendgridAuth }
        ,   timeout:    15000
        ,   agent:      httpsAgent
        });

        let body = 
        {
            "from": { "email": mail.from.addr }
        ,   "subject": mail.subject
        ,   "content": [{ "type": "text/plain", "value": mail.text }]
        ,   "personalizations": [{ "to": [] }]
        };

        if( mail.from.name ) body.from.name = mail.from.name;

        const p = body.personalizations[ 0 ];
        mail.to.forEach(( x ) => { 
            const to = { "email": x.addr }; 
            if( x.name ) to.name = x.name;
            p.to.push( to );
        });

        if( mail.cc && mail.cc.length > 0 ) {
            p.cc = [];
            mail.cc.forEach(( x ) => { 
                const cc = { "email": x.addr }; 
                if( x.name ) cc.name = x.name;
                p.cc.push( cc );
            });
        }

        if( mail.bcc && mail.bcc.length > 0 ) {
            p.bcc = [];
            mail.bcc.forEach(( x ) => { 
                const bcc = { "email": x.addr }; 
                if( x.name ) bcc.name = x.name;
                p.bcc.push( bcc );
            });
        }
        
        return { req: req, body: JSON.stringify( body )};
    }
);

// ----------------------------------------------------------------------------
// Here we maintain an array of service providers.
// We start off with the 1st provider and start sending requests to the 
// provider, even though we really don't know if it's OK until we receive a 
// response from the provider. Thus, we run the risk of sending multiple 
// requests to a failed provider.
// When a chosen provider fails, we move on to the next provider in the array,
// and again start sending requests to it, until we know it's failed.
// This is a very simple approach. The downside is if all providers fail at 
// same time, all requests would fail as well. For this exercise, no alert is
// raised when this happens.
// ----------------------------------------------------------------------------

// array of service providers
const providers = [ mailgun, sendgrid ]; 

// index to the service provider currently being used
let iProvider = 0;

// To make sure required parameters are present and providers have been set up 
// correctly. Return an error message on failure.
function initProviders()
{
    // Check if mandatory parameters are all present.
    mailgunApiKey = process.env.EMAIL_MAILGUN_API_KEY || "";
    mailgunDomain = process.env.EMAIL_MAILGUN_DOMAIN || "";
    sendgridApiKey = process.env.EMAIL_SENDGRID_API_KEY || "";
    mailgunApiKey = mailgunApiKey.trim();
    mailgunDomain = mailgunDomain.trim();
    sendgridApiKey = sendgridApiKey.trim();
    if( !mailgunApiKey ) return "Mailgun API key is missing";
    if( !mailgunDomain ) return "Mailgun domain is missing";
    if( !sendgridApiKey ) return "Sendgrid API key is missing";
    
    // Create parameters that remains unchanged hereinafter.
    mailgunAuth = "api:" + mailgunApiKey;
    sendgridAuth = "Bearer " + sendgridApiKey;

    // Check if all providers are set up correctly.
    for( let i = 0; i < providers.length; ++i ) {
        const p = providers[ i ];
        if( !p.makeReq ) return p.name + " has not been set up correctly";
    }

    // To accommodate automated unit testing only ...
    let envProvider = process.env.EMAIL_PROVIDER;
    if( envProvider ) {
        envProvider = envProvider.trim().toLowerCase();
        if( envProvider === "sendgrid" ) iProvider = 1;
    }

    return null;
}

// Return the service provider currently in use
function getProvider()
{
    return providers[ iProvider ];
}

// Move on to the next service provider.
function useNextProvider()
{
    iProvider = ( iProvider + 1 ) % providers.length;
}
