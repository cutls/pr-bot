import Koa from 'koa'
import Router from 'koa-router'
import koaBody from 'koa-body'
import axios from 'axios'
import fs from 'fs'
import { createAppAuth } from '@octokit/auth-app'
require('dotenv').config()
const repo = process.env.REPO
const appId = process.env.APP_ID
const integId = process.env.INTEG_ID
const keyFile = process.env.SECRET_KEY
const host = process.env.HOST
const appName = process.env.APP_NAME

const router = new Router()
const koa = new Koa()
router.get('/pr/:id/mastodon', async (ctx, next) => {
	console.log('mastodon')
	const id = ctx.params.id
	try {
		const title = await getPRTitle(id)
		if (title.match(/^(.*\.)+[a-zA-Z]{2,}$/)) {
			const firstCheck = await hasRightsToChange(id, title)
			if (!firstCheck) {
				ctx.response.body = 'あなたの編集できるファイルの範囲を超えています。'
				return false
			}
			const res = await axios.post(`https://${title}/api/v1/apps`, {
				scopes: 'admin:read',
				redirect_uris: `${host}/redirect/${id}/mastodon`,
				client_name: appName,
			})
			const authUrl = `https://${title}/oauth/authorize?client_id=${res.data.client_id}&client_secret=${
				res.data.client_secret
			}&response_type=code&scope=admin:read&redirect_uri=${encodeURIComponent(`${host}/redirect/${id}/mastodon`)}&state=${title},${res.data.client_id},${res.data.client_secret}`
			ctx.redirect(authUrl)
		} else {
			ctx.response.body = {
				success: false,
				note: 'modify your PR title and re-access this URL',
			}
		}
	} catch (e) {
		console.log(e)
	}
})
router.get('/pr/:id/misskey', async (ctx, next) => {
	console.log('misskey')
	const id = ctx.params.id
	try {
		const title = await getPRTitle(id)
		if (title.match(/^(.*\.)+[a-zA-Z]{2,}$/)) {
			const firstCheck = await hasRightsToChange(id, title)
			if (!firstCheck) {
				ctx.response.body = 'あなたの編集できるファイルの範囲を超えています。'
				return false
			}
			const res = await axios.post(`https://${title}/api/app/create`, {
				name: appName,
				description: appName,
				permission: ['read:account'],
				callbackUrl: `${host}/redirect/${id}/misskey`,
			})
			const appSecret = res.data.secret
			const session = await axios.post(`https://${title}/api/auth/session/generate`, {
				appSecret,
			})
			const authUrl = session.data.url
			ctx.cookies.set('token', session.data.token)
			ctx.cookies.set('appSecret', appSecret)
			ctx.cookies.set('domain', title)
			ctx.redirect(authUrl)
		} else {
			ctx.response.body = {
				success: false,
				note: 'modify your PR title and re-access this URL',
			}
		}
	} catch (e) {
		console.error(e)
		ctx.response.body = {
			success: false,
			note: 'modify your PR title and re-access this URL',
		}
	}
})
async function getPRTitle(id: string) {
	try {
		const token = await getToken()
		const raw = await axios.get(`https://api.github.com/repos/${repo}/pulls/${id}`, {
			headers: {
				Authorization: `Token ${token}`,
			},
		})
		const json = raw.data

		const title = json.title
		return title
	} catch (e) {
		console.error(e)
	}
}
async function hasRightsToChange(id: string, title: string) {
	let firstLetter = title.substr(0, 1)
	if (firstLetter.match(/[0-9]/)) firstLetter = '0'
	try {
		const token = await getToken()
		const raw = await axios.get(`https://api.github.com/repos/${repo}/pulls/${id}/commits`, {
			headers: {
				Authorization: `Token ${token}`,
			},
		})
		const json = raw.data
		let permited = true
		for (const commit of json) {
			const { url } = commit
			const raw = await axios.get(url, {
				headers: {
					Authorization: `Token ${token}`,
				},
			})
			const files = raw.data.files
			for (const file of files) {
				const fileName = file.filename
				console.log(fileName, `resources/${firstLetter}/${title}/data.json5`)
				if (fileName !== `resources/${firstLetter}/${title}/data.json5`) {
					permited = false
					break
				}
			}
			if (!permited) break
		}
		return permited
	} catch (e) {
		console.error(e)
		return false
	}
}
router.get('/redirect/:id/mastodon', async (ctx, next) => {
	console.log('mastodonRedirect')
	const idP = ctx.params.id
	const { code, id, state } = ctx.query
	const arr = typeof state === 'string' ? state.split(',') : null
	if (!arr) return (ctx.response.body = 'Error')

	try {
		console.log(`${host}/redirect/${idP}/mastodon`, arr, code)
		const res = await axios.post(`https://${arr[0]}/oauth/token`, {
			grant_type: 'authorization_code',
			redirect_uri: `${host}/redirect/${idP}/mastodon`,
			client_id: arr[1],
			client_secret: arr[2],
			code: code,
		})
		const at = res.data.access_token
		const mod = await axios.get(`https://${arr[0]}/api/v1/admin/accounts`, {
			headers: {
				Authorization: `Bearer ${at}`,
			},
		})
		let verified = false
		if (mod.status == 200) verified = true
		if (verified) {
			const res = await setLabel(idP)
			if (!res) throw 'Error'
			ctx.response.body = '認証が完了しました。閉じてもらって構いません。'
		}
	} catch (e) {
		console.log(e)
		ctx.response.body = '認証に失敗しました。鯖缶(モデレータ以上)か確認してください。'
	}
})
router.get('/redirect/:id/misskey', async (ctx, next) => {
	console.log('misskeyRedirect')
	const id = ctx.params.id
	try {
		const token = ctx.cookies.get('token')
		const appSecret = ctx.cookies.get('appSecret')
		const domain = ctx.cookies.get('domain')
		ctx.cookies.set('token', '')
		ctx.cookies.set('appSecret', '')
		ctx.cookies.set('domain', '')
		const res = await axios.post(`https://${domain}/api/auth/session/userkey`, {
			appSecret,
			token: ctx.query.token,
		})
		const user = res.data.user
		const verified = user.isAdmin || user.isModerator
		if (verified) {
			const res = await setLabel(id)
			if (!res) throw 'Error'
			ctx.response.body = '認証が完了しました。閉じてもらって構いません。'
		} else {
			throw 'Error'
		}
	} catch (e) {
		console.log(e)
		ctx.response.body = '認証に失敗しました。鯖缶(管理者以上)か確認してください。'
	}
})
async function setLabel(id: string) {
	try {
		const githubToken = await getToken()
		const raw = await axios.post(
			`https://api.github.com/repos/${repo}/issues/${id}/labels`,
			{
				labels: ['verified'],
			},
			{
				headers: {
					Authorization: `Token ${githubToken}`,
				},
			}
		)
		return true
	} catch (e) {
		console.log(e)
		return false
	}
}
router.post('/webhook', koaBody(), async (ctx, next) => {
	const token = await getToken()
	if (ctx.request.body.action == 'opened' || ctx.request.body.action == 'reopened') {
		const id = ctx.request.body.number
		const raw = await axios.post(
			`https://api.github.com/repos/${repo}/issues/${id}/comments`,
			{
				body: `鯖缶認証(モデレータ以上): [Mastodon](${host}/pr/${id}/mastodon) / [Misskey](${host}/pr/${id}/misskey)`,
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
	if (!appId || !keyFile) return null
	const auth = createAppAuth({
		appId,
		privateKey: fs.readFileSync(keyFile).toString(),
		installationId: integId,
	})
	const installationAuthentication = await auth({ type: 'installation' })
	return installationAuthentication.token
}
