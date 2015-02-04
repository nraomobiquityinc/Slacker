var express = require('express');
var bodyParser = require('body-parser');
var router = require(__dirname + '/router.js');
var config = require(__dirname + '/library/config')
var log = require(__dirname + '/library/log.js')
var bot = require(__dirname + '/bot.js')
var exphbs = require('express-handlebars');

exports.start = function() {
  bot.setup(function(error) {
    if (error) {
      log.error('bot setup failed', error)
      process.exit(-1)
    }

    var app = express();
    app.use(bodyParser.urlencoded({
      extended: false
    }));
    app.use('/', router);
    app.engine('hbs', exphbs({
      defaultLayout: 'layout',
      extname: '.hbs',
      partialsDir: 'views/partials'
    }));
    app.use(express.static(__dirname + '/public'));
    app.set('views', __dirname + '/views');
    app.set('view engine', 'hbs');
    app.set('view options', {
      layout: 'layout'
    });
    var nodePort = process.env.PORT || config.port;
    app.listen(nodePort, function() {
      log.info('listening on port ' + nodePort);
    });
  });
}
