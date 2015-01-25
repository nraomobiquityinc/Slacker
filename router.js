var authenticationHelper = require(__dirname + '/authenticationHelper.js');
var bot = require(__dirname + '/bot.js')
var cluster = require('cluster')
var config = require(__dirname + '/library/config')
var domain = require('domain');
var express = require('express');
var id = require(__dirname + '/library/id.js')
var log = require(__dirname + '/library/log.js')
var parse = require(__dirname + '/library/parse.js')
var router = module.exports = express.Router();
var url = require('url')

var requestDomain;

router.route('/')
  .all(function(request, response, next) {
    connectRequestDomainMiddleware(request, response, next);
  })
  .get(function(request, response) {
    response.end('Slacker is running.');
  })
  .post(function(request, response) {
    try {
      if (request.body.command && request.body.token === config.token.slashCommand) {
        bot.processRequest(request, response);
      } else {
        log.error('invalid token', request.body.token, request.id)
        response.statusCode = 403
        response.end()
      }
    } catch (err) {
      requestDomain.emit("error", err);
    }
  });

router.get('/oauthcallback', function(request, response) {
  authenticationHelper.handleOauthCallback(request, response);
});

router.post('/runactions/:userId', function(req, res) {
  var userId = req.params.userId;
  var selectedActionIndices = req.body;
  console.log(userId);
  console.log(selectedActionIndices);
  return res.render('actionsDone');
});

function connectRequestDomainMiddleware(request, response, nextRequestHandler) {
  requestDomain = domain.create()

  requestDomain.add(request)
  requestDomain.add(response)

  request.url = url.parse(request.url)
  request.url.parameters = request.url.query ? parse.httpParameters(request.url.query) : []
  request.id = id()

  log.info('request', {
    method: request.method,
    pathname: request.url.pathname,
    parameters: request.url.parameters,
    ip: request.connection.remoteAddress
  }, request.id)

  log.info('headers', request.headers, request.id)

  requestDomain.on('error', function(error) {
    log.error('uncaught exception', error, response.id)
    console.error(error.stack);

    try {
      var kill = setTimeout(function() {
        process.exit(1)
      }, 30000)
      kill.unref()
      cluster.worker.disconnect()
      response.statusCode = 500
      response.end()
    } catch (exception) {
      log.error('failed to respond after uncaught exception', exception, response.id)
      console.error(exception.stack);
    }
  })

  nextRequestHandler();
}