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
    balance: { type: Number, default: 0 },   // Ana bakiye (WLD COIN)
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

// Kullanıcı verilerini getirme
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ telegramId: req.params.id });
        if (!user) {
            user = await User.create({ telegramId: req.params.id });
        }

        const now = new Date();
        const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
        
        const BASE_HEAT_RATE = 100 / (4 * 3600);
        const heatPerSec = BASE_HEAT_RATE / (user.coolingPower || 1);

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
        res.status(500).json({ error: err.message });
    }
});

// Verileri Kaydetme
app.post('/api/save', async (req, res) => {
    try {
        const { telegramId, balance, gpus, heat, mined, coolingPower } = req.body;
        
        await User.findOneAndUpdate(
            { telegramId }, 
            { 
                balance, 
                gpus, 
                heat, 
                mined,
                coolingPower, 
                lastUpdate: new Date() 
            },
            { upsert: true }
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// --- PARA ÇEKME (WITHDRAW) ENDPOINT ---
app.post('/api/withdraw', async (req, res) => {
    const { telegramId, address, amount } = req.body;

    try {
        const user = await User.findOne({ telegramId });

        if (!user || user.balance < 300) {
            return res.status(400).json({ success: false, message: "Yetersiz bakiye! Minimum 300 WLD gereklidir." });
        }

        // ÖNEMLİ: Çekim talebi kaydı (Terminaline düşer)
        console.log(`
        ======= 💸 YENİ ÇEKİM TALEBİ (GigaMine) =======
        KULLANICI ID : ${telegramId}
        MİKTAR       : ${amount.toFixed(2)} WLD
        CÜZDAN ADRESİ: ${address}
        TARİH        : ${new Date().toLocaleString('tr-TR')}
        ==============================================
        `);

        // Kullanıcı bakiyesini sıfırla
        user.balance = 0;
        await user.save();

        // Admin'e (sana) Telegram üzerinden de bildirim gönderelim (İsteğe bağlı)
        // Bunun çalışması için senin Telegram ID'ni bilmemiz gerekir.
        // bot.telegram.sendMessage('SENIN_ID', `🚨 Çekim Talebi!\nID: ${telegramId}\nMiktar: ${amount} WLD\nAdres: ${address}`);

        res.json({ success: true });
    } catch (err) {
        console.error("Çekim hatası:", err);
        res.status(500).json({ success: false, message: "Sunucu hatası oluştu." });
    }
});

// --- TELEGRAM STARS FATURA OLUŞTURMA ---
app.post('/api/create-stars-invoice', async (req, res) => {
    const { telegramId, type, power, starPrice, title } = req.body;

    try {
        const invoiceUrl = await bot.telegram.createInvoiceLink({
            title: `GigaMine: ${title}`,
            description: `${title} ile WLD COIN üretim gücünüzü artırın!`,
            payload: JSON.stringify({ telegramId, type, power, title }),
            provider_token: "", 
            currency: "XTR", 
            prices: [{ label: title, amount: parseInt(starPrice) }]
        });
        
        res.json({ invoiceUrl });
    } catch (err) {
        console.error("Fatura Hatası:", err);
        res.status(500).json({ error: "Fatura oluşturulamadı." });
    }
});

// --- ÖDEME DOĞRULAMA (WEBHOOK) ---
bot.on('pre_checkout_query', (ctx) => {
    ctx.answerPreCheckoutQuery(true);
});

bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);
    const { telegramId, type, power, title } = payload;

    try {
        let user = await User.findOne({ telegramId });
        if (user) {
            if (type === 'gpu') {
                user.gpus += power;
            } else if (type === 'cool') {
                user.coolingPower += (power * 4.0); 
            }
            await user.save();
            console.log(`ÖDEME ONAYLANDI: User ${telegramId}, ${type} +${power}`);
            
            await ctx.reply(`✅ Tebrikler! Satın aldığınız ${title || type.toUpperCase()} başarıyla kuruldu ve WLD COIN kazımı hızlandı.`);
        }
    } catch (err) {
        console.error("Başarılı ödeme sonrası DB güncelleme hatası:", err);
    }
});

// 4. BOT KOMUTLARI
bot.start((ctx) => {
    ctx.reply(`🚀 GigaMinebot'a Hoş Geldin!\n\nSen kapatsan da GPU'ların WLD COIN kazmaya devam eder.\n\n🔥 300 WLD biriktir ve çekim talebi gönder!`, 
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Madenciliği Başlat', WEBAPP_URL)]
        ])
    );
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

bot.launch().then(() => console.log("GigaMinebot WLD COIN Sürümü Yayında! 🤖"));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});

// Sunucuyu uyandırma döngüsü
setInterval(() => {
    if(WEBAPP_URL) axios.get(WEBAPP_URL).catch(() => {});
}, 600000);
