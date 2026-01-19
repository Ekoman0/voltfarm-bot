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

// 2. VERİTABANI MODELLERİ
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, unique: true },
    balance: { type: Number, default: 0 },   // Ana bakiye (WLD COIN)
    mined: { type: Number, default: 0 },     // Toplanmamış biriken
    gpus: { type: Number, default: 1 },
    coolingPower: { type: Number, default: 1 }, // Soğutma gücü
    heat: { type: Number, default: 0 }, 
    lastUpdate: { type: Date, default: Date.now },
    invitedCount: { type: Number, default: 0 }, // Gerçek referans sayısı
    groupShares: { type: Number, default: 0 },
    completedTasks: { type: [Number], default: [] }, // Tamamlanan görev ID'leri
    // GÜNLÜK GİRİŞ SİSTEMİ VERİLERİ
    streak: { type: Number, default: 0 },
    lastCheckIn: { type: Number, default: 0 }
});

const taskSchema = new mongoose.Schema({
    title: String,
    reward: Number,
    link: String,
    isActive: { type: Boolean, default: true }
});

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);

// MongoDB Bağlantısı
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Bağlantısı Başarılı! ✅"))
    .catch(err => console.error("MongoDB Hatası:", err));

// 3. API UÇLARI (USER & GAME)

// Kullanıcı verilerini getirme (Offline kazanç ve seri sıfırlama hesaplaması)
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ telegramId: req.params.id });
        if (!user) {
            user = await User.create({ telegramId: req.params.id });
        }

        const now = new Date();
        const currentTime = now.getTime();

        // --- GÜNLÜK SERİ KONTROLÜ (48 SAAT GEÇTİYSE SIFIRLA) ---
        if (user.lastCheckIn !== 0) {
            const diff = currentTime - user.lastCheckIn;
            const fortyEightHours = 48 * 60 * 60 * 1000;
            if (diff > fortyEightHours) {
                user.streak = 0; // Seri bozuldu, 0'dan başla
            }
        }

        const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
        
        const BASE_HEAT_RATE = 100 / (4 * 3600); // 4 saatte %100 ısınma
        const heatPerSec = BASE_HEAT_RATE / (user.coolingPower || 1);

        // Offline madencilik hesaplaması (En önemli kısım)
        if (gapInSeconds > 0 && user.heat < 100) {
            const currentHeat = user.heat;
            const heatNeededToMax = 100 - currentHeat;
            const secondsUntilOverheat = heatNeededToMax / heatPerSec;
            const activeMiningSeconds = Math.min(gapInSeconds, secondsUntilOverheat);
            
            const offlineEarning = activeMiningSeconds * (user.gpus * 0.0005);
            user.mined += offlineEarning;
            user.heat = Math.min(100, currentHeat + (gapInSeconds * heatPerSec));
        }

        user.lastUpdate = now;
        await user.save();
        res.json(user);
    } catch (err) {
        console.error("User Fetch Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Verileri Kaydetme (GÜNCEL: Streak ve lastCheckIn eklendi)
app.post('/api/save', async (req, res) => {
    try {
        const { 
            telegramId, balance, gpus, heat, mined, 
            coolingPower, inviteCount, groupShareCount, 
            newCompletedTask, streak, lastCheckIn 
        } = req.body;
        
        let updateFields = { 
            balance, 
            gpus, 
            heat, 
            mined,
            coolingPower,
            invitedCount: inviteCount,
            groupShares: groupShareCount,
            streak: streak,
            lastCheckIn: lastCheckIn,
            lastUpdate: new Date() 
        };

        let updateQuery = { $set: updateFields };
        if (newCompletedTask) {
            updateQuery.$addToSet = { completedTasks: newCompletedTask };
        }

        const result = await User.findOneAndUpdate(
            { telegramId }, 
            updateQuery,
            { upsert: true, new: true }
        );
        
        res.status(200).json({ success: true, user: result });
    } catch (err) {
        console.error("Kayıt Hatası:", err);
        res.status(500).send(err.message);
    }
});

// Dinamik Görevleri Getirme
app.get('/api/tasks', async (req, res) => {
    try {
        const tasks = await Task.find({ isActive: true });
        res.json(tasks);
    } catch (err) {
        res.status(500).json([]);
    }
});

// --- ADMIN API UÇLARI ---
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find().sort({ balance: -1 });
        res.json(users);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/admin/add-task', async (req, res) => {
    try {
        const { title, reward, link } = req.body;
        const task = await Task.create({ title, reward, link });
        res.json(task);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/admin/delete-task/:id', async (req, res) => {
    try {
        await Task.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// --- PARA ÇEKME (WITHDRAW) ---
app.post('/api/withdraw', async (req, res) => {
    const { telegramId, address, amount } = req.body;
    try {
        const user = await User.findOne({ telegramId });
        if (!user || user.balance < 300) {
            return res.status(400).json({ success: false, message: "Limit Not Reached! Min 300 WLD required." });
        }
        if (user.invitedCount < 10 || user.groupShares < 5) {
            return res.status(400).json({ success: false, message: "Tasks not completed! 10 invites and 5 shares required." });
        }

        console.log(`💸 WITHDRAWAL REQUEST: User ${telegramId} | Amount: ${amount} WLD | Addr: ${address}`);
        user.balance = 0;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error("Withdraw Error:", err);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// --- TELEGRAM STARS FATURA ---
app.post('/api/create-stars-invoice', async (req, res) => {
    const { telegramId, type, power, starPrice, title } = req.body;
    try {
        const invoiceUrl = await bot.telegram.createInvoiceLink({
            title: `GigaMine: ${title}`,
            description: `${title} üretimi artırır!`,
            payload: JSON.stringify({ telegramId, type, power, title }),
            provider_token: "", 
            currency: "XTR", 
            prices: [{ label: title, amount: parseInt(starPrice) }]
        });
        res.json({ invoiceUrl });
    } catch (err) {
        res.status(500).json({ error: "Invoice error." });
    }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);
    const { telegramId, type, power, title } = payload;
    try {
        let user = await User.findOne({ telegramId });
        if (user) {
            if (type === 'gpu') user.gpus += power;
            else if (type === 'cool') user.coolingPower += (power * 4.0); 
            await user.save();
            await ctx.reply(`✅ Purchase Successful! ${title} installed.`);
        }
    } catch (err) { console.error("Payment Error:", err); }
});

// 4. BOT KOMUTLARI & REFERANS SİSTEMİ
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const startPayload = ctx.payload;
    try {
        let user = await User.findOne({ telegramId });
        if (!user) {
            user = await User.create({ telegramId });
            if (startPayload && !isNaN(startPayload) && parseInt(startPayload) !== telegramId) {
                const inviterId = parseInt(startPayload);
                await User.findOneAndUpdate(
                    { telegramId: inviterId },
                    { $inc: { invitedCount: 1, balance: 40 } }
                );
                bot.telegram.sendMessage(inviterId, "🎁 New friend joined! You earned +40 WLD reward.");
            }
        }
        const botRefLink = `https://t.me/GigaMinebot?start=${telegramId}`;
        ctx.reply(`🚀 Welcome to GigaMine, ${ctx.from.first_name}!\n\n🔗 Referral Link:\n${botRefLink}\n\n🔥 Collect 300 WLD and invite 10 friends to withdraw!`, 
            Markup.inlineKeyboard([
                [Markup.button.webApp('🎮 Start Mining', WEBAPP_URL)],
                [Markup.button.url('📢 Invite Friends', `https://t.me/share/url?url=${encodeURIComponent(botRefLink)}&text=Join GigaMine and mine WLD! ⚡`)]
            ])
        );
    } catch (err) { console.error("Start Error:", err); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

bot.launch().then(() => console.log("GigaMinebot is Live! 🤖"));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is active on port ${PORT}.`);
});

// Ping
setInterval(() => {
    if(WEBAPP_URL) axios.get(WEBAPP_URL).catch(() => {});
}, 600000);
