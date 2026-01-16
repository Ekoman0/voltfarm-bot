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

// 2. VERİTABANI MODELİ (Heat eklendi)
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, unique: true },
    balance: { type: Number, default: 0 },
    gpus: { type: Number, default: 1 },
    heat: { type: Number, default: 0 }, // Isıyı artık kaydediyoruz
    lastUpdate: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// MongoDB Bağlantısı
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Bağlantısı Başarılı! ✅"))
    .catch(err => console.error("MongoDB Hatası:", err));

// 3. API UÇLARI

// Kullanıcı verilerini getirme ve kapalıyken geçen süreyi hesaplama
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ telegramId: req.params.id });
        if (!user) {
            user = await User.create({ telegramId: req.params.id });
        }

        const now = new Date();
        const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
        
        if (gapInSeconds > 0) {
            // Isınma hızı: saniyede 0.3 artış
            const currentHeat = user.heat;
            const heatNeededToMax = 100 - currentHeat;
            const secondsUntilOverheat = heatNeededToMax / 0.3;

            // Ne kadar süre kazım yapabildi? (Ya geçen süre, ya da aşırı ısınana kadar geçen süre)
            const activeMiningSeconds = Math.min(gapInSeconds, Math.max(0, secondsUntilOverheat));
            
            // Kazanç hesapla
            const offlineEarning = activeMiningSeconds * (user.gpus * 0.0005);
            
            // Isı artışını hesapla
            const totalHeatIncrease = gapInSeconds * 0.3;
            
            user.balance += offlineEarning;
            user.heat = Math.min(100, currentHeat + totalHeatIncrease);
            user.lastUpdate = now;
            await user.save();
        }

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verileri kaydetme yolu (Heat buraya da eklendi)
app.post('/api/save', async (req, res) => {
    try {
        const { telegramId, balance, gpus, heat } = req.body;
        await User.findOneAndUpdate(
            { telegramId }, 
            { 
                balance, 
                gpus, 
                heat, 
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
    ctx.reply(`🚀 VoltFarm'a Hoş Geldin!`, 
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

setInterval(() => {
    if(WEBAPP_URL) axios.get(WEBAPP_URL).catch(() => {});
}, 600000);
