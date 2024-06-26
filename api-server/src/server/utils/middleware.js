import dedent from 'dedent';
import { validationResult } from 'express-validator';
import { isURL } from 'validator';

import { createValidatorErrorFormatter } from './create-handled-error.js';

import {
  getAccessTokenFromRequest,
  removeCookies
} from './getSetAccessToken.js';
import { getRedirectParams } from './redirection';

export function ifNoUserRedirectHome(message, type = 'errors') {
  return function (req, res, next) {
    const { path } = req;
    if (req.user) {
      return next();
    }

    const { origin } = getRedirectParams(req);
    req.flash(type, message || `You must be signed in to access ${path}`);

    return res.redirect(origin);
  };
}

export function ifNoUserSend(sendThis) {
  return function (req, res, next) {
    if (req.user) {
      return next();
    }
    return res.status(200).send(sendThis);
  };
}

export function ifNoUser401(req, res, next) {
  if (req.user) {
    return next();
  }
  return res.status(401).end();
}

export function ifNotVerifiedRedirectToUpdateEmail(req, res, next) {
  const { user } = req;
  if (!user) {
    return next();
  }
  if (!user.emailVerified) {
    req.flash(
      'danger',
      dedent`
        We do not have your verified email address on record,
        please add it in the settings to continue with your request.
      `
    );
    return res.redirect('/settings');
  }
  return next();
}

export function ifUserRedirectTo(status) {
  status = status === 301 ? 301 : 302;
  return (req, res, next) => {
    const { accessToken } = getAccessTokenFromRequest(req);
    const { returnTo } = getRedirectParams(req);
    if (req.user && accessToken) {
      return res.status(status).redirect(returnTo);
    }
    if (req.user && !accessToken) {
      // This request has an active auth session
      // but there is no accessToken attached to the request
      // perhaps the user cleared cookies?
      // we need to remove the zombie auth session
      removeCookies(req, res);
      delete req.session.passport;
    }
    return next();
  };
}

export function ifNotMobileRedirect() {
  return (req, res, next) => {
    //
    // Todo: Use the below check once we have done more research on usage
    //
    // const isMobile = /(iPhone|iPad|Android)/.test(req.headers['user-agent']);
    // if (!isMobile) {
    //  res.json({ error: 'not from mobile' });
    // } else {
    //  next();
    // }
    next();
  };
}
// for use with express-validator error formatter
export const createValidatorErrorHandler =
  (...args) =>
  (req, res, next) => {
    const validation = validationResult(req).formatWith(
      createValidatorErrorFormatter(...args)
    );

    if (!validation.isEmpty()) {
      const errors = validation.array();
      return next(errors.pop());
    }

    return next();
  };

const allowedDomains = ['codewars-tracker-be.herokuapp.com'];

export async function ifValidWebhookURL(req, res, next) {
  const {
    user: { username },
    body: { webhook, webhookSecret }
  } = req;

  if (!isURL(webhook, { require_protocol: true, protocols: ['https'] })) {
    return res.status(400).json({
      type: 'danger',
      message: 'flash.webhook-invalid'
    });
  }

  const webhookUrl = new URL(webhook);
  const isDomainAllowed = allowedDomains.some(domain => {
    return webhookUrl.hostname === domain;
  });

  if (!isDomainAllowed) {
    return res.status(403).json({
      type: 'danger',
      message: 'flash.webhook-not-allowed'
    });
  }

  try {
    await triggerWebhook(webhook, webhookSecret, username);
    next();
  } catch (error) {
    return res.status(400).json({
      type: 'danger',
      message: 'flash.webhook-validation-failed',
      technicalMessage: error.message
    });
  }
}

async function triggerWebhook(url, secret, username) {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      username,
      secret,
      eventType: 'webhook_added'
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) {
    throw new Error('There was an error sending data to the provided URL.');
  }
}
