'use server';

import { createClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getURL, getErrorRedirect, getStatusRedirect } from 'utils/helpers';
import { getAuthTypes } from 'utils/auth-helpers/settings';
import {
  provisionNewUser,
  touchLastLogin,
  EmailVerificationRequiredError
} from '@/utils/dara/provision';
import {
  resolvePlatformAdmin,
  recordPlatformAdminLogin
} from '@/utils/dara/platform';
import { PW_RESET_COOKIE } from '@/utils/dara/pw-reset';

// DARA-046: an IMPLICIT-flow auth client for the email flows whose branded templates use the
// token_hash `/auth/confirm` link (password recovery, sign-up confirmation). The app's default
// SSR client is PKCE, which makes the email's `{{ .TokenHash }}` a `pkce_…` code that
// /auth/confirm's verifyOtp cannot verify — it would need exchangeCodeForSession plus the
// code-verifier cookie from the originating browser, absent when the link is opened from an
// email scanner (Outlook SafeLinks) or another device. The implicit flow makes `{{ .TokenHash }}`
// a plain OTP hash that verifyOtp validates server-side, cross-device. Anon key, no session
// persistence — these calls only trigger an email; the session is established later at
// /auth/confirm. (Assumes "Confirm email" is ON, so sign-up returns no immediate session.)
function newImplicitAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false } }
  );
}

function isValidEmail(email: string) {
  var regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
  return regex.test(email);
}

export async function redirectToPath(path: string) {
  return redirect(path);
}

export async function SignOut(formData: FormData) {
  const pathName = String(formData.get('pathName')).trim();

  const supabase = createClient();
  const { error } = await supabase.auth.signOut();

  // DARA-031: drop the MFA recovery marker so a backup-code session can't carry over.
  try {
    cookies().set('dara-mfa', '', { path: '/', maxAge: 0 });
  } catch {
    // ignore — best-effort cookie clear
  }

  if (error) {
    return getErrorRedirect(
      pathName,
      'Hmm... Something went wrong.',
      'You could not be signed out.'
    );
  }

  return '/signin';
}

export async function signInWithEmail(formData: FormData) {
  const cookieStore = cookies();
  const callbackURL = getURL('/auth/callback');

  const email = String(formData.get('email')).trim();
  let redirectPath: string;

  if (!isValidEmail(email)) {
    redirectPath = getErrorRedirect(
      '/signin/email_signin',
      'Invalid email address.',
      'Please try again.'
    );
  }

  const supabase = createClient();
  let options = {
    emailRedirectTo: callbackURL,
    shouldCreateUser: true
  };

  // If allowPassword is false, do not create a new user
  const { allowPassword } = getAuthTypes();
  if (allowPassword) options.shouldCreateUser = false;
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: options
  });

  if (error) {
    redirectPath = getErrorRedirect(
      '/signin/email_signin',
      'You could not be signed in.',
      error.message
    );
  } else if (data) {
    cookieStore.set('preferredSignInView', 'email_signin', { path: '/' });
    redirectPath = getStatusRedirect(
      '/signin/email_signin',
      'Success!',
      'Please check your email for a magic link. You may now close this tab.',
      true
    );
  } else {
    redirectPath = getErrorRedirect(
      '/signin/email_signin',
      'Hmm... Something went wrong.',
      'You could not be signed in.'
    );
  }

  return redirectPath;
}

export async function requestPasswordUpdate(formData: FormData) {
  const callbackURL = getURL('/auth/reset_password');

  // Get form data
  const email = String(formData.get('email')).trim();
  let redirectPath: string;

  if (!isValidEmail(email)) {
    // Return early — otherwise we'd fall through and fire a reset for a malformed
    // address, overwriting this message with a bogus "success".
    return getErrorRedirect(
      '/signin/forgot_password',
      'Invalid email address.',
      'Please try again.'
    );
  }

  // DARA-046: fire the recovery email from an implicit-flow client so its token_hash
  // link verifies cross-device (see newImplicitAuthClient).
  const supabase = newImplicitAuthClient();

  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callbackURL
  });

  if (error) {
    redirectPath = getErrorRedirect(
      '/signin/forgot_password',
      error.message,
      'Please try again.'
    );
  } else if (data) {
    redirectPath = getStatusRedirect(
      '/signin/forgot_password',
      'Success!',
      'Please check your email for a password reset link. You may now close this tab.',
      true
    );
  } else {
    redirectPath = getErrorRedirect(
      '/signin/forgot_password',
      'Hmm... Something went wrong.',
      'Password reset email could not be sent.'
    );
  }

  return redirectPath;
}

export async function signInWithPassword(formData: FormData) {
  const cookieStore = cookies();
  const email = String(formData.get('email')).trim();
  const password = String(formData.get('password')).trim();
  const remember = formData.get('remember') === 'on';
  let redirectPath: string;

  // "Remember me": when off, mark the session session-only so it clears on browser
  // close — set the flag BEFORE sign-in and create the client in session-only mode
  // so the auth cookies it writes are session-scoped immediately. The middleware
  // reads this flag to keep refreshed cookies session-scoped too.
  if (remember) {
    cookieStore.set('dara-remember', 'true', {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365
    });
  } else {
    cookieStore.set('dara-remember', 'false', { path: '/', sameSite: 'lax' });
  }

  const supabase = createClient({ sessionOnly: !remember });
  const { error, data } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    redirectPath = getErrorRedirect(
      '/signin/password_signin',
      'Sign in failed.',
      error.message
    );
  } else if (data.user) {
    // Application admins are company-less operators — skip tenant provisioning and
    // route to the admin console.
    const admin = await resolvePlatformAdmin(data.user.email);
    if (admin) {
      await recordPlatformAdminLogin(data.user.email ?? '', data.user.id);
      cookieStore.set('preferredSignInView', 'password_signin', { path: '/' });
      return getStatusRedirect('/app/admin', 'Success!', 'You are now signed in.');
    }
    // Email+password sign-in does not pass through /auth/callback, so provision
    // the Dara company/user here too. provisionNewUser is idempotent.
    try {
      await provisionNewUser(
        data.user.id,
        data.user.email ?? '',
        data.user.user_metadata?.full_name ?? data.user.email ?? '',
        // A password signer has proven email ownership only once Supabase has
        // confirmed the address (email_confirmed_at set). Gates invite acceptance.
        Boolean(data.user.email_confirmed_at)
      );
      await touchLastLogin(data.user.id);
      cookieStore.set('preferredSignInView', 'password_signin', { path: '/' });
      redirectPath = getStatusRedirect('/', 'Success!', 'You are now signed in.');
    } catch (e) {
      if (e instanceof EmailVerificationRequiredError) {
        // Pending invite for an unverified address — refuse the join and drop the
        // session so there's no authenticated-but-unprovisioned redirect loop.
        await supabase.auth.signOut();
        redirectPath = getErrorRedirect(
          '/signin/password_signin',
          'Verify your email first.',
          'You have a pending invitation. Confirm your email address, then sign in to join your team.'
        );
      } else {
        throw e;
      }
    }
  } else {
    redirectPath = getErrorRedirect(
      '/signin/password_signin',
      'Hmm... Something went wrong.',
      'You could not be signed in.'
    );
  }

  return redirectPath;
}

export async function signUp(formData: FormData) {
  const callbackURL = getURL('/auth/callback');

  const email = String(formData.get('email')).trim();
  const password = String(formData.get('password')).trim();
  let redirectPath: string;

  if (!isValidEmail(email)) {
    // Return early — otherwise we'd fall through and attempt the sign-up with a
    // malformed address, overwriting this message.
    return getErrorRedirect(
      '/signin/signup',
      'Invalid email address.',
      'Please try again.'
    );
  }

  // DARA-046: sign up via the implicit-flow client so the confirmation email's
  // token_hash link (confirmation.html → /auth/confirm?...&type=signup) is a plain OTP
  // hash verifyOtp can verify cross-device, not a `pkce_…` code (see newImplicitAuthClient).
  // With "Confirm email" ON, signUp returns no session here — the session is established
  // at /auth/confirm — so a non-cookie client is correct.
  const supabase = newImplicitAuthClient();
  const { error, data } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: callbackURL
    }
  });

  if (error) {
    redirectPath = getErrorRedirect(
      '/signin/signup',
      'Sign up failed.',
      error.message
    );
  } else if (data.session) {
    redirectPath = getStatusRedirect('/', 'Success!', 'You are now signed in.');
  } else if (
    data.user &&
    data.user.identities &&
    data.user.identities.length == 0
  ) {
    redirectPath = getErrorRedirect(
      '/signin/signup',
      'Sign up failed.',
      'There is already an account associated with this email address. Try resetting your password.'
    );
  } else if (data.user) {
    redirectPath = getStatusRedirect(
      '/',
      'Success!',
      'Please check your email for a confirmation link. You may now close this tab.'
    );
  } else {
    redirectPath = getErrorRedirect(
      '/signin/signup',
      'Hmm... Something went wrong.',
      'You could not be signed up.'
    );
  }

  return redirectPath;
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password')).trim();
  const passwordConfirm = String(formData.get('passwordConfirm')).trim();
  let redirectPath: string;

  // Check that the password and confirmation match. Return early — otherwise we'd fall
  // through and update the password anyway, overwriting this message.
  if (password !== passwordConfirm) {
    return getErrorRedirect(
      '/signin/update_password',
      'Your password could not be updated.',
      'Passwords do not match.'
    );
  }

  const supabase = createClient();
  const { error, data } = await supabase.auth.updateUser({
    password
  });

  if (error) {
    redirectPath = getErrorRedirect(
      '/signin/update_password',
      'Your password could not be updated.',
      error.message
    );
  } else if (data.user) {
    // DARA-046: the new password is set — clear the forced-reset marker so the middleware
    // stops gating /app, then let the user into the app.
    cookies().set(PW_RESET_COOKIE, '', { path: '/', maxAge: 0 });
    redirectPath = getStatusRedirect(
      '/',
      'Success!',
      'Your password has been updated.'
    );
  } else {
    redirectPath = getErrorRedirect(
      '/signin/update_password',
      'Hmm... Something went wrong.',
      'Your password could not be updated.'
    );
  }

  return redirectPath;
}

export async function updateEmail(formData: FormData) {
  // Get form data
  const newEmail = String(formData.get('newEmail')).trim();

  // Check that the email is valid
  if (!isValidEmail(newEmail)) {
    return getErrorRedirect(
      '/account',
      'Your email could not be updated.',
      'Invalid email address.'
    );
  }

  const supabase = createClient();

  const callbackUrl = getURL(
    getStatusRedirect('/account', 'Success!', `Your email has been updated.`)
  );

  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    {
      emailRedirectTo: callbackUrl
    }
  );

  if (error) {
    return getErrorRedirect(
      '/account',
      'Your email could not be updated.',
      error.message
    );
  } else {
    return getStatusRedirect(
      '/account',
      'Confirmation emails sent.',
      `You will need to confirm the update by clicking the links sent to both the old and new email addresses.`
    );
  }
}

export async function updateName(formData: FormData) {
  // Get form data
  const fullName = String(formData.get('fullName')).trim();

  const supabase = createClient();
  const { error, data } = await supabase.auth.updateUser({
    data: { full_name: fullName }
  });

  if (error) {
    return getErrorRedirect(
      '/account',
      'Your name could not be updated.',
      error.message
    );
  } else if (data.user) {
    return getStatusRedirect(
      '/account',
      'Success!',
      'Your name has been updated.'
    );
  } else {
    return getErrorRedirect(
      '/account',
      'Hmm... Something went wrong.',
      'Your name could not be updated.'
    );
  }
}
