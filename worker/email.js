// Password reset email through Resend. RESEND_API_URL can point at a local
// capture server in tests, or at any Resend-compatible relay when self-hosting.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function sendResetEmail(env, to, link) {
  if (!env.RESEND_API_KEY) {
    // Self-hosted without email: the owner reads the link from the server log.
    if (env.LOG_RESET_LINKS === '1') console.log(`Password reset link for ${to}: ${link}`);
    return false;
  }
  const url = env.RESEND_API_URL || 'https://api.resend.com/emails';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#0a0a0a">
  <p style="font-size:24px;font-weight:700;margin:0 0 8px">nullboard</p>
  <p style="font-size:14px;line-height:1.6;color:#4a4a4a">Someone asked to reset the password for this account. The link works once and expires in one hour.</p>
  <p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;padding:10px 20px;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none">Reset password</a></p>
  <p style="font-size:12px;color:#6a6a6a">If you did not ask for this, ignore the email. Your password stays as it is.</p>
</div>`;
  const text = `Reset your nullboard password: ${link}\n\nThe link works once and expires in one hour. If you did not ask for this, ignore this email.`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'nullboard <onboarding@resend.dev>',
        to: [to],
        subject: 'Reset your nullboard password',
        html,
        text,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
