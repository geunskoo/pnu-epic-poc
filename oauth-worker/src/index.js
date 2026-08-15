const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function randomState() {
	return crypto.randomUUID();
}

async function handleAuth(request, env) {
	const url = new URL(request.url);
	const state = randomState();
	const redirectUri = `${url.origin}/callback`;

	const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
	authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
	authorizeUrl.searchParams.set('redirect_uri', redirectUri);
	authorizeUrl.searchParams.set('scope', 'repo,user');
	authorizeUrl.searchParams.set('state', state);

	const headers = new Headers({ Location: authorizeUrl.toString() });
	// state is only used to defend against CSRF on /callback; a short-lived
	// cookie is enough since this proxy has no other server-side storage.
	headers.append(
		'Set-Cookie',
		`oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
	);

	return new Response(null, { status: 302, headers });
}

function getCookie(request, name) {
	const cookie = request.headers.get('Cookie') || '';
	const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
	return match ? match[1] : null;
}

function renderCallbackPage({ success, token, error }) {
	// Decap CMS's github backend expects this exact postMessage handshake:
	// the popup announces itself, waits for the opener to reply (which also
	// hands over the opener's origin), then sends the token only to that origin.
	const payload = success
		? { token, provider: 'github' }
		: { provider: 'github', message: error || 'OAuth 인증 실패' };
	const messageType = success ? 'success' : 'error';

	return `<!doctype html>
<html>
<body>
<script>
(function () {
	function receiveMessage(message) {
		window.opener.postMessage(
			'authorization:github:${messageType}:${JSON.stringify(payload)}',
			message.origin
		);
		window.removeEventListener('message', receiveMessage, false);
	}
	window.addEventListener('message', receiveMessage, false);
	window.opener.postMessage('authorizing:github', '*');
})();
</script>
</body>
</html>`;
}

async function handleCallback(request, env) {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const cookieState = getCookie(request, 'oauth_state');

	if (!code || !state || state !== cookieState) {
		return new Response(renderCallbackPage({ success: false, error: 'invalid state' }), {
			status: 400,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		});
	}

	const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		// client_secret only ever leaves this Worker in this one request —
		// it never touches the browser.
		body: JSON.stringify({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
			redirect_uri: `${url.origin}/callback`,
		}),
	});

	const tokenData = await tokenResponse.json();

	if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
		return new Response(
			renderCallbackPage({ success: false, error: tokenData.error_description || 'token exchange failed' }),
			{ status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
		);
	}

	return new Response(renderCallbackPage({ success: true, token: tokenData.access_token }), {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Set-Cookie': 'oauth_state=; Path=/; Max-Age=0',
		},
	});
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/auth') {
			return handleAuth(request, env);
		}
		if (url.pathname === '/callback') {
			return handleCallback(request, env);
		}
		return new Response('pnu-epic-poc OAuth proxy — see /auth', { status: 200 });
	},
};
