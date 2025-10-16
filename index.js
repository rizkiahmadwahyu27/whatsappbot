// index.js

import {
    useMultiFileAuthState,
    makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import express from 'express';
import qrcode from 'qrcode';

// --- UTILITY FUNCTION ---
// Fungsi delay untuk jeda anti-blokir
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- EXPRESS APP SETUP ---
const app = express();
app.use(express.json());

// Variabel sock di scope global agar bisa diakses oleh Express API
let sock;

// --- API ENDPOINTS ---

// Endpoint untuk cek status bot
app.get('/', (req, res) => {
    res.json({
        status: sock?.user ? "connected" : "disconnected",
        message: sock?.user
            ? `✅ Bot aktif (${sock.user.id})`
            : "❌ Belum terkoneksi ke WhatsApp"
    })
});

// Endpoint kirim pesan
app.post('/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;
        
        if (!number || !message) {
             return res.status(400).json({ success: false, error: 'Nomor dan pesan wajib diisi.' });
        }

        if (!sock || !sock.user)
            return res.status(500).json({ success: false, error: 'Bot belum terkoneksi ke WhatsApp' });

        // Format nomor (pastikan format 628xxxx)
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

        // Kirim pesan dengan retry dan delay
        let success = false;
        let attempts = 0;

        while (!success && attempts < 3) {
            try {
                // Tambahkan jeda 1 detik sebelum percobaan pertama dan retry
                await delay(1000); 
                await sock.sendMessage(jid, { text: message });
                success = true;
                console.log(`📤 Pesan terkirim ke ${number}`);
            } catch (err) {
                attempts++;
                console.log(`⚠️ Gagal kirim (percobaan ${attempts}) ke ${number}:`, err.message);
                // Tambahkan jeda yang lebih lama untuk percobaan retry
                await delay(3000 * attempts); 
            }
        }

        if (!success) {
            throw new Error('Gagal mengirim pesan setelah 3 percobaan');
        }

        res.json({ success: true, target: number });
    } catch (err) {
        console.error('❌ Error kirim pesan:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- WHATSAPP CONNECTION LOGIC ---

// Fungsi utama untuk menghubungkan bot
async function connectToWhatsApp() {
    console.log('Memulai koneksi ke WhatsApp...');

    // 1. Ambil status otentikasi (session) dari folder "auth_info_baileys"
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // 2. Ambil versi terbaru baileys
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Versi Baileys terbaru: ${version}`);

    // 3. Konfigurasi dan buat socket
    sock = makeWASocket({
        version,
        printQRInTerminal: true, // Coba tampilkan QR di terminal
        auth: state,
        browser: ['Chrome (Desktop)', 'Desktop', '3.0'], // Mengatasi User-Agent yang usang
        // PENTING: Meningkatkan batas waktu koneksi untuk mengatasi Connection Failure
        connectTimeoutMs: 40000, 
        // PENTING: Atur ulang ping interval (default 25s) untuk menjaga koneksi tetap hidup
        keepAliveIntervalMs: 25000, 
    });

    // 4. Handler untuk event koneksi dan session
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n=================================================');
            console.log('Pindai QR Code ini untuk login:');
            
            // [PERBAIKAN UNTUK LINUX/SSH] Menampilkan URL gambar QR Code
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qr)}`;
            console.log(`🔗 BUKA LINK INI DI BROWSER ANDA UNTUK MEMINDAI: ${qrUrl}`);

            // Mencoba menampilkan di terminal (sebagai opsi sekunder yang mungkin gagal)
            qrcode.toString(qr, { type: 'terminal', small: true }, (err, data) => {
                if (err) return console.log('Gagal menampilkan QR di terminal, gunakan link di atas.');
                console.log('--- TAMPILAN QR TERMINAL (MUNGKIN TIDAK TERBACA) ---');
                console.log(data);
                console.log('--------------------------------------------------');
            });

            console.log('=================================================\n');
        }

        // Penanganan Disconnect
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            let reason;
            try {
                 reason = new DisconnectReason(statusCode);
            } catch (e) {
                 reason = DisconnectReason.unknown;
            }

            console.error(`\n❌ Koneksi terputus! Alasan: ${lastDisconnect.error.message || 'Unknown Error'} - Kode: ${statusCode}`);

            // Logika untuk koneksi ulang
            if (reason === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('🔥 Logged Out atau Otentikasi Gagal. Hapus folder sesi dan coba jalankan lagi.');
            } else if (statusCode !== 401) { 
                console.log('🔄 Mencoba koneksi ulang dalam 5 detik...');
                setTimeout(connectToWhatsApp, 5000); 
            }
        } else if (connection === 'open') {
            console.log('✅ Koneksi berhasil dibuka!');
        }
    });

    // 5. Handler untuk menyimpan kredensial (penting!)
    sock.ev.on('creds.update', saveCreds);

    // 6. Handler untuk pesan (contoh sederhana)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return; 

        const jid = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        
        if (text.toLowerCase() === 'halo') {
            await sock.sendMessage(jid, { text: 'Halo kembali! Bot API Anda sudah berjalan.' });
        }
    });
}

// --- SERVER INITIALIZATION ---

// 1. Jalankan koneksi WhatsApp
connectToWhatsApp().catch(err => {
    console.error("Gagal menjalankan bot secara keseluruhan:", err);
});

// 2. Jalankan server Express
const PORT = 4000;
app.listen(PORT, () => console.log(`🚀 Bot API aktif di http://localhost:${PORT}`));
