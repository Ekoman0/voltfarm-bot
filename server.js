const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

// 1. AYARLAR (Render Environment Variables kısmından gelir)
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = process.env.PORT || 3000;

const app = express();
const bot = new Telegraf(BOT_TOKEN);

// JSON verilerini okuyabilmek için gerekli
app.use(express.json());
app.use(express.static(__dirname));

// 2. VERİTABANI MODELİ
// Kullanıcının neleri kaydedilecek?
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, unique: true },
    balance: { type: Number, default: 0 },
    gpus: { type: Number, default: 1 },
    lastUpdate: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// MongoDB Bağlantısı
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Bağlantısı Başarılı! ✅"))
    .catch(err => console.error("MongoDB Hatası:", err));

// 3. API UÇLARI (index.html buraya bağlanır)

// Kullanıcı verilerini getirme ve çevrimdışı kazancı hesaplama
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ telegramId: req.params.id });
        if (!user) {
            user = await User.create({ telegramId: req.params.id });
        }

        // ÇEVRİMDIŞI KAZIM HESABI
        const now = new Date();
        const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
        
        // Cihazın ısınma süresini hesaba katıyoruz (Örn: 1000 saniyede ısınır)
        // Isı 100 olana kadar geçen süreyi bulup sadece o süreyi kazandırıyoruz
        const maxMiningTime = 1000; // Saniye cinsinden cihazın %100 ısıya ulaşma süresi
        const effectiveGap = Math.min(gapInSeconds, maxMiningTime);
        
        const offlineEarning = effectiveGap * (user.gpus * 0.0005);
        
        user.balance += offlineEarning;
        user.lastUpdate = now; // Saati güncelle
        await user.save();

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verileri kaydetme yolu
app.post('/api/save', async (req, res) => {
    try {
        const { telegramId, balance, gpus } = req.body;
        await User.findOneAndUpdate(
            { telegramId }, 
            { balance, gpus, lastUpdate: new Date() },
            { upsert: true }
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 4. BOT KOMUTLARI
bot.start((ctx) => {
    ctx.reply(`🚀 VoltFarm'a Hoş Geldin!`, 
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Madenciliği Başlat', WEBAPP_URL)]
        ])
    );
});

// 5. BAŞLATMA
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

bot.launch();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});

// Cron-job olmasa bile Render'ı uyanık tutma çabası
setInterval(() => {
    if(WEBAPP_URL) axios.get(WEBAPP_URL).catch(() => {});
}, 600000);
