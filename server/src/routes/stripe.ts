/**
 * stripe.ts
 * Stripe webhook handler — provisions license keys when a payment succeeds.
 * Also exposes a checkout session creation endpoint.
 */

import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { getDb } from '../database';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16' as Stripe.LatestApiVersion
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export const stripeRouter = Router();

/** Create a Stripe Checkout session for Pro subscription */
stripeRouter.post('/create-checkout', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email required' });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID,
          quantity: 1
        }
      ],
      success_url: `${process.env.LANDING_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.LANDING_URL}/#pricing`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/** Stripe webhook — provision license key on successful payment */
stripeRouter.post('/webhook', async (req: Request, res: Response) => {
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      req.headers['stripe-signature'] as string,
      webhookSecret
    );
  } catch (err) {
    console.error('[Stripe] Webhook signature error:', err);
    res.status(400).send('Invalid signature');
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_email;
    if (!email) {
      res.json({ received: true });
      return;
    }

    try {
      const db = getDb();
      // Generate a license key
      const licenseKey = generateLicenseKey();

      // Upsert user
      await db`
        INSERT INTO users (email, license_key, tier)
        VALUES (${email}, ${licenseKey}, 'pro')
        ON CONFLICT (email) DO UPDATE
          SET license_key = ${licenseKey}, tier = 'pro'
      `;

      // Insert license key record
      await db`
        INSERT INTO license_keys (key, tier)
        VALUES (${licenseKey}, 'pro')
        ON CONFLICT (key) DO NOTHING
      `;

      console.log(`[Stripe] Pro license provisioned for ${email}: ${licenseKey}`);
      // TODO: Send the license key to the user via email (use Resend / Postmark)
    } catch (err) {
      console.error('[Stripe] DB error during provisioning:', err);
    }
  }

  res.json({ received: true });
});

function generateLicenseKey(): string {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CODESYNC-${seg()}-${seg()}-${seg()}`;
}
