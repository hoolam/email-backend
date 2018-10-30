# A Simple Email Backend Server #

A server that accepts HTTP POST requests with the following information in the
request bodies, URL-encoded and in the form of a HTTP query string, and send
them as emails via the email service providers Mailgun or Sendgrid:

-   from:       sender's email address
-   to:         recipient's email address
-   cc:         email address to CC to
-   bcc:        email address to BCC to
-   subject:    subject, in plain text
-   text:       message, in plain text

"from", "to", "subject" and "text" are mandatory.

Multiple "to"'s are allowed.

Zero or more "cc"'s and "bcc"'s are allowed.

## Install ##

    npm install

## Usage ##

The server can be started as follows:

    node index.js

It is configurable via the following environment variables:

-   EMAIL_PORT  
    The port number the server listens to.
    Default is 8080.

-   EMAIL_LOG_DIR  
    Log directory.
    All log files are created in this directory.
    Defaults to the directory where code for this server are on.

-   EMAIL_LOG_LEVEL  
    Message logging level - "debug", "info" "warn" or "error".
    Defaults to "info".

-   EMAIL_MAILGUN_API_KEY  
    Mailgun's API key, without which the server would not start.

-   EMAIL_MAILGUN_DOMAIN  
    Mailgun requires at least one domain name - a mail manipulated through a
    Mailgun API must be associated with a domain name. 
    This simple server can only deal with one domain name, and it would not
    start without a domain name.

-   EMAIL_SENDGRID_API_KEY  
    Sendgrid's API key, without which the server would not start

It accepts HTTP requests of the following form:

    POST /mail HTTP/1.x
    Host: ...
    Content-Type: application/x-www-form-urlencoded

A request can be sent from a browser, or by using the Linux utility curl, as
follows:

    curl http://localhost:8080/mail -d 'from=...&to=...&subject=...&text=...'

## Notable Features ##

-   Asynchronous and not blocking the event loop

-   Two log files are produced - an Apache-style access log and a message log.

-   Share and re-use connections to service providers by making use of NodeJS's
    HTTP agents.

-   Every callbacks are wrapped in a try-catch thus preventing exceptions from
    escaping and crashing gthe server

-   Use reputable libraries like express, body-parser, morgan and winston to
    both get things done quicker and make server safer

-   No zombie requests - time out requests to service providers

-   When a service provider fails, it automatically switch to the next service
    providers.

-   The side dealing with clients and the side dealing with service providers
    are cleanly separated, in 2 source files, thus enhance code maintainability

-   Sensitive infomation such API keys are not hardcoded in the code, thus
    avaoiding a rather common security risk

## Limitations ##

Due to time constarints, the following limitations exist.

-   Only support the most rudimentary email features.
    No attachments, no HTML contents, etc.

-   Supports only HTTP POST with URL-encoded query strings in request bodies.
    Does not support multipart forms.

-   Does not support HTTPS, due to absence of a verifiable TLS certificate.
    Thus, transmissions between clients and server are in clear text - no
    protection against eavesdropping, and no server authentication.

-   Mailgun and Sendgrid imposes some rate limits on free accounts.
    Thus, requests to Mailgun and Sendgrid would time out at times.
    As a result, this server is not suitable for high traffic.

-   We start off with the 1st provider and start sending requests to the
    provider, even though we really don't know if it's OK until we receive a
    response from the provider. Thus, we run the risk of sending multiple
    requests to a failed provider.

    When a chosen provider fails, we move on to the next provider, and again
    start sending requests to it, until we know it's failed.  This is a very
    simple approach. The downside is if all providers fail at same time, all
    requests would fail as well. For this exercise, no alert is raised when this
    happens.

-   Does not support linux admin utility logrotate.

-   Not run under the supervision of a tool like "forever", thus does not
    restart after crashes

-   Not raising alerts in the event of serious errors.

-   No defence against DoS attacks

-   Does not support client authentication and authorization, such as the use of
    a API key.

-   No access control, like rate limiting.

-   Not using promises and/or async/await
    I am still learning about and in the process of switching over to promises
    and async/await

-   Tested in NodeJS 8 only

-   Subjected to simple unit testing only.
    More vigorous testing is required.

## Unit Testing ##

-   3 test cases

-   A test case to test mails with invalid parameters

-   A test case to test sending emails via Mailgun

-   A test case to test sending emails via Sendgrid

-   Mailgun and Sendgrid imposes some rate limits on free accounts thus the
    above 2 tests would fail at times
