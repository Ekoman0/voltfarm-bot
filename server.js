const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; // MongoDB'den aldığın link
const WEBAPP_URL = process.env.WEBAPP_URL;

const app = express();
const bot = new Telegraf(BOT_TOKEN);

// 1. Veritabanı Şeması (Kullanıcı verileri burada saklanır)
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, unique: true },
    balance: { type: Number, default: 0 },
    gpus: { type: Number, default: 1 },
    lastUpdate: { type: Date, default: Date.now } // Kapalıyken kazım için kritik
});
const User = mongoose.model('User', userSchema);

// 2. MongoDB Bağlantısı
mongoose.connect(MONGO_URI).then(() => console.log("MongoDB Bağlandı! ✅"));

app.use(express.json());
app.use(express.static(__dirname));

// 3. Mini App için API uçları
// Kullanıcı verilerini getir
app.get('/api/user/:id', async (req, res) => {
    let user = await User.findOne({ telegramId: req.params.id });
    if (!user) {
        user = await User.create({ telegramId: req.params.id });
    }
    
    // OFFLINE KAZIM HESAPLAMA
    const now = new Date();
    const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
    const offlineEarning = gapInSeconds * (user.gpus * 0.0005); // GPU başına saniyelik kazanç
    
    user.balance += offlineEarning;
    user.lastUpdate = now;
    await user.save();

    res.json(user);
});

// Verileri Kaydet (Buna oyun içinden periyodik olarak istek atacağız)
app.post('/api/save', async (req, res) => {
    const { telegramId, balance, gpus } = req.body;
    await User.findOneAndUpdate({ telegramId }, { balance, gpus, lastUpdate: new Date() });
    res.sendStatus(200);
});

bot.start((ctx) => {
    ctx.reply("VoltFarm'a Hoş Geldin!", Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Madene Gir', WEBAPP_URL)]
    ]));
});

bot.launch();
app.listen(process.env.PORT || 3000);
