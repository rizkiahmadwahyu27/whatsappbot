import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'
import express from 'express'
import qrcode from 'qrcode-terminal'

// Inisialisasi Express
const app = express()
app.use(express.json())

let sock

// Fungsi delay (anti spam)
const delay = ms => new Promise(res => setTimeout(res, ms))

// Fungsi koneksi ulang otomatis
async function connectWa() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth')

    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        browser: ['BaileysBot', 'Chrome', '1.0']
    })

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true })

        if (connection === 'open') {
            console.log('✅ WhatsApp connected!')
        } else if (connection === 'close') {
            console.log('❌ Koneksi terputus, mencoba reconnect...')
            connectWa()
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

connectWa()

// Endpoint untuk cek status bot
app.get('/', (req, res) => {
    res.json({
        status: sock?.user ? "connected" : "disconnected",
        message: sock?.user
            ? `✅ Bot aktif (${sock.user.id})`
            : "❌ Belum terkoneksi ke WhatsApp"
    })
})

// Endpoint kirim pesan
app.post('/send-message', async (req, res) => {
    try {
        const { number, message } = req.body
        if (!sock || !sock.user)
            return res.status(500).json({ success: false, error: 'Bot belum terkoneksi ke WhatsApp' })

        // Format nomor
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`

        // Kirim pesan dengan retry dan delay
        let success = false
        let attempts = 0

        while (!success && attempts < 3) {
            try {
                await sock.sendMessage(jid, { text: message })
                success = true
                console.log(`📤 Pesan terkirim ke ${number}`)
            } catch (err) {
                attempts++
                console.log(`⚠️ Gagal kirim (percobaan ${attempts}) ke ${number}:`, err.message)
                await delay(2000 * attempts) // tunggu 2-6 detik sebelum retry
            }
        }

        if (!success) {
            throw new Error('Gagal mengirim pesan setelah 3 percobaan')
        }

        // Tambahkan jeda 2 detik antar pengiriman (anti blokir)
        await delay(2000)

        res.json({ success: true })
    } catch (err) {
        console.error('❌ Error kirim pesan:', err)
        res.status(500).json({ success: false, error: err.message })
    }
})

// Jalankan server
const PORT = 4000
app.listen(PORT, () => console.log(`🚀 Bot aktif di http://localhost:${PORT}`))
