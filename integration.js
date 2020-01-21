'use strict';

const request = require('request');
const config = require('./config/config');
const async = require('async');
const fs = require('fs');

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
function startup(logger) {
  let defaults = {};
  Logger = logger;

  const { cert, key, passphrase, ca, proxy, rejectUnauthorized } = config.request;

  if (typeof cert === 'string' && cert.length > 0) {
    defaults.cert = fs.readFileSync(cert);
  }

  if (typeof key === 'string' && key.length > 0) {
    defaults.key = fs.readFileSync(key);
  }

  if (typeof passphrase === 'string' && passphrase.length > 0) {
    defaults.passphrase = passphrase;
  }

  if (typeof ca === 'string' && ca.length > 0) {
    defaults.ca = fs.readFileSync(ca);
  }

  if (typeof proxy === 'string' && proxy.length > 0) {
    defaults.proxy = proxy;
  }

  if (typeof rejectUnauthorized === 'boolean') {
    defaults.rejectUnauthorized = rejectUnauthorized;
  }

  requestWithDefaults = request.defaults(defaults);
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.debug(entities);

  entities.forEach((entity) => {
    let requestOptions = {
      method: 'GET',
      uri: 'https://stat.ripe.net/data/abuse-contact-finder/data.json',
      qs: {
        resource: entity.value
      },
      json: true
    };

    Logger.trace({ uri: requestOptions }, 'Request URI');

    tasks.push(function(done) {
      requestWithDefaults(requestOptions, function(error, res, body) {
        let processedResult = handleRestError(error, entity, res, body);

        if (processedResult.error) {
          done(processedResult);
          return;
        }

        done(null, processedResult);
      });
    });
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      Logger.error({ err: err }, 'Error');
      cb(err);
      return;
    }

    results.forEach((result) => {
      if (result.body === null || result.body.length === 0) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: [],
            details: result.body
          }
        });
      }
    });

    Logger.debug({ lookupResults }, 'Results');
    cb(null, lookupResults);
  });
}

function doPrefixLookup(entity, cb) {
  let requestOptions = {
    method: 'GET',
    uri: 'https://stat.ripe.net/data/announced-prefixes/data.json',
    qs: {
      resource: entity.value
    },
    json: true
  };

  request(requestOptions, (error, response, body) => {
    let processedResult = handleRestError(error, entity, response, body);

    if (processedResult.error) {
      cb(processedResult);
      return;
    }

    cb(null, processedResult.body);
  });
}

function onDetails(lookupObject, options, cb) {
  doPrefixLookup(lookupObject.entity, (err, results) => {
    if (err) {
      Logger.error({ err }, 'Error running onDetails lookup');
      return cb(err);
    }
    //store the results into the details object so we can access them in our template
    lookupObject.data.details.prefix = results;

    Logger.trace({ lookup: results }, 'Looking at the data after on details.');

    cb(null, lookupObject.data);
  });
}

function handleRestError(error, entity, res, body) {
  let result;

  if (error) {
    return {
      error: error,
      detail: 'HTTP Request Error'
    };
  }

  if (res.statusCode === 200) {
    // we got data!
    result = {
      entity: entity,
      body: body
    };
  } else if (res.statusCode === 404) {
    // no result found
    result = {
      entity: entity,
      body: null
    };
  } else if (res.statusCode === 202) {
    // no result found
    result = {
      entity: entity,
      body: null
    };
  } else {
    // unexpected status code
    result = {
      error: body,
      detail: `${body.error}: ${body.message}`
    };
  }
  return result;
}

module.exports = {
  doLookup: doLookup,
  onDetails: onDetails,
  startup: startup
};
