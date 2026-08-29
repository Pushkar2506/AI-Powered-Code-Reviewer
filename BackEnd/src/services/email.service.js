const APP_NAME = 'AI Powered Code Reveiwer'
const net = require('net')
const tls = require('tls')

function getFrontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function normalizeEmailFrom(value) {
    const fallback = `${APP_NAME} <onboarding@resend.dev>`
    const raw = String(value || fallback).trim()

    if (raw.includes('<') && raw.includes('>')) return raw

    const parts = raw.split(/\s+/)
    const email = parts[parts.length - 1]
    const name = parts.slice(0, -1).join(' ').trim() || APP_NAME

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return `${name} <${email}>`
    }

    return fallback
}

function requireEmailConfig() {
    if ((process.env.EMAIL_DRIVER || 'resend').toLowerCase() === 'smtp') {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            const error = new Error('SMTP email delivery is not configured.')
            error.statusCode = 503
            throw error
        }
        return
    }

    if (!process.env.RESEND_API_KEY) {
        const error = new Error('Email delivery is not configured.')
        error.statusCode = 503
        throw error
    }
}

async function sendEmail({ to, subject, html, text }) {
    requireEmailConfig()
    const driver = (process.env.EMAIL_DRIVER || 'resend').toLowerCase()

    if (driver === 'smtp') {
        await sendSmtpEmail({ to, subject, html, text })
        return
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: normalizeEmailFrom(process.env.EMAIL_FROM),
            to,
            subject,
            html,
            text
        })
    })

    if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error('Resend email rejected:', {
            status: response.status,
            statusText: response.statusText,
            body
        })
        const error = new Error('Unable to send email right now.')
        error.statusCode = 502
        throw error
    }
}

function encodeHeader(value) {
    return String(value || '').replace(/[\r\n]/g, ' ')
}

function escapeSmtpData(value) {
    return String(value || '')
        .replace(/\r?\n/g, '\r\n')
        .replace(/^\./gm, '..')
}

function buildMimeMessage({ from, to, subject, html, text }) {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const recipients = Array.isArray(to) ? to : [to]
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@ai-powered-code-reviewer.local>`

    return [
        `From: ${encodeHeader(from)}`,
        `To: ${recipients.map(encodeHeader).join(', ')}`,
        `Subject: ${encodeHeader(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: ${messageId}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        text || '',
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        html || '',
        '',
        `--${boundary}--`,
        ''
    ].join('\r\n')
}

function parseEmailAddress(value) {
    const match = String(value || '').match(/<([^>]+)>/)
    return (match ? match[1] : value).trim()
}

function createSmtpConnection() {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(Number(process.env.SMTP_PORT) || 587, process.env.SMTP_HOST)
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
    })
}

function readSmtpResponse(socket) {
    return new Promise((resolve, reject) => {
        let buffer = ''

        function cleanup() {
            socket.off('data', onData)
            socket.off('error', onError)
        }

        function onError(error) {
            cleanup()
            reject(error)
        }

        function onData(chunk) {
            buffer += chunk.toString('utf8')
            const lines = buffer.split(/\r?\n/).filter(Boolean)
            const last = lines[lines.length - 1]
            if (/^\d{3} /.test(last)) {
                cleanup()
                resolve(buffer)
            }
        }

        socket.on('data', onData)
        socket.once('error', onError)
    })
}

async function smtpCommand(socket, command, expectedCodes) {
    socket.write(`${command}\r\n`)
    const response = await readSmtpResponse(socket)
    const code = Number(response.slice(0, 3))
    if (!expectedCodes.includes(code)) {
        const error = new Error(`SMTP command failed with ${code}.`)
        error.smtpResponse = response
        throw error
    }
    return response
}

async function upgradeToTls(socket) {
    return new Promise((resolve, reject) => {
        const secureSocket = tls.connect({
            socket,
            servername: process.env.SMTP_HOST
        }, () => resolve(secureSocket))
        secureSocket.once('error', reject)
    })
}

async function sendSmtpEmail({ to, subject, html, text }) {
    const recipients = Array.isArray(to) ? to : [to]
    const from = normalizeEmailFrom(process.env.EMAIL_FROM || process.env.SMTP_USER)
    const fromAddress = parseEmailAddress(from)
    let socket = await createSmtpConnection()

    try {
        await readSmtpResponse(socket)
        await smtpCommand(socket, 'EHLO localhost', [250])
        await smtpCommand(socket, 'STARTTLS', [220])
        socket = await upgradeToTls(socket)
        await smtpCommand(socket, 'EHLO localhost', [250])
        await smtpCommand(socket, 'AUTH LOGIN', [334])
        await smtpCommand(socket, Buffer.from(process.env.SMTP_USER).toString('base64'), [334])
        await smtpCommand(socket, Buffer.from(String(process.env.SMTP_PASS).replace(/\s+/g, '')).toString('base64'), [235])
        await smtpCommand(socket, `MAIL FROM:<${fromAddress}>`, [250])

        for (const recipient of recipients) {
            await smtpCommand(socket, `RCPT TO:<${parseEmailAddress(recipient)}>`, [250, 251])
        }

        await smtpCommand(socket, 'DATA', [354])
        socket.write(`${escapeSmtpData(buildMimeMessage({ from, to: recipients, subject, html, text }))}\r\n.\r\n`)
        const dataResponse = await readSmtpResponse(socket)
        const dataCode = Number(dataResponse.slice(0, 3))
        if (dataCode !== 250) {
            const error = new Error(`SMTP send failed with ${dataCode}.`)
            error.smtpResponse = dataResponse
            throw error
        }
        console.log('SMTP email accepted:', {
            to: recipients.map(parseEmailAddress),
            subject,
            response: dataResponse.trim()
        })
        await smtpCommand(socket, 'QUIT', [221])
    } catch (error) {
        console.error('SMTP email failed:', error.smtpResponse || error.message)
        const publicError = new Error('Unable to send email right now.')
        publicError.statusCode = 502
        throw publicError
    } finally {
        socket.end()
    }
}

function page({ title, intro, actionLabel, actionUrl }) {
    return `
        <div style="font-family:Inter,Arial,sans-serif;background:#f6f8fb;padding:32px;color:#172033">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d9e1ec;border-radius:10px;padding:28px">
                <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#0f766e;text-transform:uppercase">${APP_NAME}</p>
                <h1 style="margin:0 0 14px;font-size:24px">${title}</h1>
                <p style="margin:0 0 24px;line-height:1.6;color:#536174">${intro}</p>
                <a href="${actionUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:800">${actionLabel}</a>
                <p style="margin:24px 0 0;color:#7b8797;font-size:13px;line-height:1.5">This link expires automatically. If you did not request this email, you can ignore it.</p>
            </div>
        </div>
    `
}

async function sendVerificationEmail(user, token) {
    const actionUrl = `${getFrontendUrl()}/?verifyToken=${encodeURIComponent(token)}`
    await sendEmail({
        to: user.email,
        subject: `Verify your ${APP_NAME} account`,
        html: page({
            title: 'Verify your email address',
            intro: 'Confirm your email so your account can safely receive team invitations and account recovery emails.',
            actionLabel: 'Verify email',
            actionUrl
        }),
        text: `Verify your ${APP_NAME} account: ${actionUrl}`
    })
}

async function sendPasswordResetEmail(user, token) {
    const actionUrl = `${getFrontendUrl()}/?resetToken=${encodeURIComponent(token)}`
    await sendEmail({
        to: user.email,
        subject: `Reset your ${APP_NAME} password`,
        html: page({
            title: 'Reset your password',
            intro: 'Use this secure link to choose a new password for your account.',
            actionLabel: 'Reset password',
            actionUrl
        }),
        text: `Reset your ${APP_NAME} password: ${actionUrl}`
    })
}

async function sendInvitationEmail({ email, inviterName, workspaceName, role, token }) {
    const actionUrl = `${getFrontendUrl()}/?inviteToken=${encodeURIComponent(token)}`
    await sendEmail({
        to: email,
        subject: `You were invited to ${workspaceName}`,
        html: page({
            title: `Join ${workspaceName}`,
            intro: `${inviterName} invited you to collaborate as ${role}. Sign in with this email address, then accept the invitation.`,
            actionLabel: 'Accept invitation',
            actionUrl
        }),
        text: `${inviterName} invited you to ${workspaceName} as ${role}. Accept here: ${actionUrl}`
    })
}

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendInvitationEmail
}
