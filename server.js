const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

// 1. AYARLAR
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = process.env.PORT || 3000;

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());
app.use(express.static(__dirname));

// 2. VERİTABANI MODELİ
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, unique: true },
    balance: { type: Number, default: 0 },   // Ana bakiye
    mined: { type: Number, default: 0 },     // Toplanmamış biriken
    gpus: { type: Number, default: 1 },
    coolingPower: { type: Number, default: 1 }, // Soğutma gücü
    heat: { type: Number, default: 0 }, 
    lastUpdate: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// MongoDB Bağlantısı
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Bağlantısı Başarılı! ✅"))
    .catch(err => console.error("MongoDB Hatası:", err));

// 3. API UÇLARI

// Kullanıcı verilerini getirme ve Çevrimdışı Kazım Hesaplama
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ telegramId: req.params.id });
        if (!user) {
            user = await User.create({ telegramId: req.params.id });
        }

        const now = new Date();
        const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
        
        // Isınma hızı frontend ile aynı olmalı: (0.18 / coolingPower)
        const heatPerSec = 0.18 / (user.coolingPower || 1);

        if (gapInSeconds > 0 && user.heat < 100) {
            const currentHeat = user.heat;
            const heatNeededToMax = 100 - currentHeat;
            
            // Maksimum ısıya ne kadar sürede ulaşır?
            const secondsUntilOverheat = heatNeededToMax / heatPerSec;

            // Gerçek kazım süresi (Geçen süre veya cihazın ısınana kadar geçirdiği süre)
            const activeMiningSeconds = Math.min(gapInSeconds, secondsUntilOverheat);
            
            // Çevrimdışı kazanç hesabı
            const offlineEarning = activeMiningSeconds * (user.gpus * 0.0005);
            user.mined += offlineEarning;

            // Isıyı yeni duruma göre güncelle
            user.heat = Math.min(100, currentHeat + (gapInSeconds * heatPerSec));
        }

        user.lastUpdate = now;
        await user.save();
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verileri Kaydetme (Gelen coolingPower artık kaydediliyor)
app.post('/api/save', async (req, res) => {
    try {
        // req.body içinden coolingPower'ı almayı unutmamalıyız!
        const { telegramId, balance, gpus, heat, mined, coolingPower } = req.body;
        
        await User.findOneAndUpdate(
            { telegramId }, 
            { 
                balance, 
                gpus, 
                heat, 
                mined,
                coolingPower, // Burası artık boş gitmeyecek
                lastUpdate: new Date() 
            },
            { upsert: true }
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 4. BOT KOMUTLARI
bot.start((ctx) => {
    ctx.reply(`🚀 VoltFarm'a Hoş Geldin!\n\nSen kapatsan da GPU'ların çalışmaya devam eder, ancak ısınmaya dikkat et!`, 
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Madenciliği Başlat', WEBAPP_URL)]
        ])
    );
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

bot.launch();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});

// Sunucuyu uyandırma döngüsü
setInterval(() => {
    if(WEBAPP_URL) axios.get(WEBAPP_URL).catch(() => {});
}, 600000);
