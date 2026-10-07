// Sign in to the test server and make every fetch() to it carry the session cookie.
// The account is created by tests/run-all.sh (fresh): node tools/user.js add tester master --password-stdin
// Returns the cookie value (for Playwright: context.addCookies([{ name: 'cn_sid', value, url: BASE }])).
const USER = process.env.TEST_USER || 'tester', PASS = process.env.TEST_PASS || 'test-password-1234';
module.exports = async function signIn(B) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
  if (!r.ok) throw new Error('test sign-in failed (' + r.status + ') - was the test account created? (tests/run-all.sh does it)');
  const sid = (r.headers.get('set-cookie') || '').match(/cn_sid=([^;]+)/)[1];
  const orig = global.fetch;
  global.fetch = (u, o) => {
    if (String(u).startsWith(B)) { o = Object.assign({}, o); o.headers = Object.assign({}, o.headers || {}, { Cookie: 'cn_sid=' + sid }); }
    return orig(u, o);
  };
  global.fetch.unsigned = orig;
  return sid;
};
