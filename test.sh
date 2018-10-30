#!/bin/bash

# -----------------------------------------------------------------------------
# Shell script to drive test cases
# Use this script instead of test.js because this sets the appropriate 
# environment variables to test either Mailgun or Sendgrid
# -----------------------------------------------------------------------------

startServer()
{
    PID=`ps -ef | fgrep node | fgrep index | fgrep -v grep | awk '{print $2}'`
    if test -n "$PID"; then kill $PID; sleep 1; fi
    rm -f *.log
    node index.js &
    sleep 3
}

TEST_CASE=`echo $1 | tr [:upper:] [:lower:]`

if test "$TEST_CASE" = 'bad-params'; then

    startServer
    node test bad-params

elif test "$TEST_CASE" = 'mailgun'; then

    export EMAIL_PROVIDER=mailgun
    node test mailgun

elif test "$TEST_CASE" = 'sendgrid'; then

    export EMAIL_PROVIDER=sendgrid
    node test sendgrid

else

    echo 'usage: test.sh ( bad-params | mailgun | sendgrid )'
    exit 1

fi
