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
	const payloadJson = JSON.stringify(JSON.stringify(payload)); // safe to embed as a JS string literal

	return `<!doctype html>
<html>
<body style="font: 13px monospace; padding: 1.5rem; color: #333;">
<p id="status">처리 중...</p>
<script>
(function () {
	var statusEl = document.getElementById('status');
	function setStatus(text) {
		statusEl.textContent = text;
		console.log('[oauth-callback]', text);
	}

	if (!window.opener) {
		setStatus('오류: window.opener가 없습니다 (팝업이 아니라 직접 접속한 경우 정상입니다). 이 창을 닫고 다시 시도해주세요.');
		return;
	}

	var messageType = ${JSON.stringify(messageType)};
	var payloadStr = ${payloadJson};
	var closed = false;

	function receiveMessage(message) {
		// Ignore unrelated message events (extensions, injected scripts, etc.) —
		// only the opener's handshake reply matches this exact payload.
		if (message.data !== 'authorizing:github') {
			setStatus('무관한 message 이벤트 무시함 (from ' + message.origin + ', data=' + JSON.stringify(message.data) + ')');
			return;
		}
		setStatus('opener 핸드셰이크 응답 확인(from ' + message.origin + '), 토큰 전달함. 디버깅을 위해 창은 자동으로 닫지 않습니다 — 직접 닫아주세요.');
		window.opener.postMessage('authorization:github:' + messageType + ':' + payloadStr, message.origin);
		window.removeEventListener('message', receiveMessage, false);
		closed = true;
	}
	window.addEventListener('message', receiveMessage, false);
	setStatus('opener에 handshake 전송함, 응답 대기 중...');
	window.opener.postMessage('authorizing:github', '*');

	setTimeout(function () {
		if (!closed) {
			setStatus('5초 넘게 opener 응답이 없습니다. Decap CMS 창이 이 팝업의 opener가 맞는지, 콘솔에 에러가 없는지 확인해주세요. (messageType=' + messageType + ')');
		}
	}, 5000);
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
