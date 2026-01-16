const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const path = require('path');
const axios = require('axios');

// 1. AYARLAR: Token ve Linkleri sistemden çekiyoruz
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // Render/Ngrok linkin
const PORT = process.env.PORT || 3000;

const app = express();
const bot = new Telegraf(BOT_TOKEN);

// 2. WEB SUNUCUSU AYARLARI
app.use(express.static(__dirname)); // index.html'i okuması için

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. BOT KOMUTLARI
bot.start((ctx) => {
    const user = ctx.from.first_name;
    
    // Eğer WEBAPP_URL tanımlı değilse uyarı ver (test aşaması için)
    if (!WEBAPP_URL) {
        return ctx.reply("Hata: WEBAPP_URL tanımlanmamış. Lütfen sunucu ayarlarını kontrol edin.");
    }

    ctx.reply(`🚀 Selam ${user}! VoltFarm'a hoş geldin.\n\nAlttaki butona basarak madencilik çiftliğini yönetmeye başlayabilirsin.`, 
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Oyunu Başlat', WEBAPP_URL)]
        ])
    );
});

// 4. SUNUCU VE BOTU BAŞLATMA
bot.launch().then(() => {
    console.log("------------------------------------");
    console.log("🤖 Telegram Bot: AKTİF");
}).catch(err => console.error("Bot başlatılamadı:", err));

app.listen(PORT, () => {
    console.log(`🌐 Web Sunucusu: localhost:${PORT} portunda AKTİF`);
    console.log("------------------------------------");
});

// 5. RENDER UYKU MODU ENGELLEYİCİ (10 dakikada bir ping atar)
if (WEBAPP_URL) {
    setInterval(() => {
        axios.get(WEBAPP_URL)
            .then(() => console.log("Ping: Sunucu uyanık tutuluyor..."))
            .catch(() => console.log("Ping: Hata oluştu (normaldir)."));
    }, 600000); 
}

// Güvenli kapatma
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));