"use strict";

var fs = require('fs');
var config;

var configExists = fs.existsSync(__dirname + '/../config.json');

if (!configExists) {
  config = {
    "port": 8421,
    "mongoDbConnectionString": process.env.MONGODB_CONNECTION_STRING,
    "logs": "logs",
    "token": {
      "slashCommand": process.env.TOKEN_SLASH_COMMAND,
      "user": process.env.TOKEN_USER
    },
    "timeout": 8000,
    "authClientId": process.env.SLACK_CLIENT_ID,
    "authClientSecret": process.env.SLACK_CLIENT_SECRET
  };
} else {
  config = require(__dirname + '/../config.json');
}

module.exports = config;
