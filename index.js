const Koa = require('koa')
const Router = require('koa-router')
const koaBody = require('koa-body')
const axios = require('axios')
const fs = require('fs')
const { createAppAuth } = require('@octokit/auth-app')
const { execSync } = require('child_process')
require('dotenv').config()
const repo = process.env.REPO
const appId = process.env.APP_ID
const integId = process.env.INTEG_ID
const keyFile = process.env.SECRET_KEY
const host = process.env.HOST
const appName = process.env.APP_NAME

const router = new Router()
const koa = new Koa()
router.get('/pr/:id', async (ctx, next) => {
	const id = ctx.params.id
	const token = await getToken()
	console.log(`https://api.github.com/repos/${repo}/pulls/${id}`)
	const raw = await axios.get(`https://api.github.com/repos/${repo}/pulls/${id}`, {
		headers: {
			Authorization: `Token ${token}`,
		},
	})
	const json = raw.data

	const title = json.title
	console.log(title)
	if (title.match(/^(.*\.)+[a-zA-Z]{2,}$/)) {
		const res = await axios.post(`https://${title}/api/v1/apps`, {
			scopes: 'admin:read',
			redirect_uris: `${host}/redirect/${id}`,
			client_name: appName,
		})
		const authUrl = `https://${title}/oauth/authorize?client_id=${res.data.client_id}&client_secret=${res.data.client_secret}&response_type=code&scope=admin:read&redirect_uri=${encodeURIComponent(
			`${host}/redirect/${id}`
		)}&state=${title},${res.data.client_id},${res.data.client_secret}`
		ctx.redirect(authUrl)
	} else {
		ctx.response.body = {
			success: false,
			note: 'modify your PR title and re-access this URL',
		}
	}
})
router.get('/redirect/:id', async (ctx, next) => {
	const token = await getToken()
	let code = ctx.query.code
	const id = ctx.params.id
	const arr = ctx.query.state.split(',')
	const res = await axios.post(`https://${arr[0]}/oauth/token`, {
		grant_type: 'authorization_code',
		redirect_uri: `${host}/redirect/${id}`,
		client_id: arr[1],
		client_secret: arr[2],
		code: code,
	})
	const at = res.data.access_token
	console.log(at)
	try {
		const mod = await axios.get(`https://${arr[0]}/api/v1/admin/accounts`, {
			headers: {
				Authorization: `Bearer ${at}`,
			},
		})
		let verified = false
		if (mod.status == 200) verified = true
		console.log(verified)
		if (verified) {
			const raw = await axios.post(
				`https://api.github.com/repos/${repo}/issues/${id}/labels`,
				{
					labels: 'verified',
				},
				{
					headers: {
						Authorization: `Token ${token}`,
					},
				}
			)
			console.log(raw)
			ctx.response.body = '認証が完了しました。閉じてもらって構いません。'
		}
	} catch (e) {
		console.log(e)
		ctx.response.body = '認証に失敗しました。鯖缶(モデレータ以上)か確認してください。'
	}
})
router.post('/webhook', koaBody(), async (ctx, next) => {
	const token = await getToken()
	if (ctx.request.body.action == 'opened') {
		const id = ctx.request.body.number
		const raw = await axios.post(
			`https://api.github.com/repos/${repo}/issues/${id}/comments`,
			{
				body: `Mastodon鯖缶認証(モデレータ以上): ${host}/pr/${id}`,
			},
			{
				headers: {
					Authorization: `Token ${token}`,
				},
			}
		)
	}
})
router.post('/commithook', async (ctx, next) => {
	ctx.response.body = 'OK'
})
koa.use(router.routes())
koa.use(koaBody())
koa.use(router.allowedMethods())

koa.listen(4001, () => {
	console.log('Server started!!')
})
async function getToken() {
	const auth = createAppAuth({
		appId: appId,
		privateKey: fs.readFileSync(keyFile),
		installationId: integId,
	})
	const installationAuthentication = await auth({ type: 'installation' })
	return installationAuthentication.token
}
