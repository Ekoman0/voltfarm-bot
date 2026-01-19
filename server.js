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

// Kullanıcı verilerini getirme ve Çevrimdışı Kazım Hesaplama
app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ telegramId: req.params.id });
        if (!user) {
            user = await User.create({ telegramId: req.params.id });
        }

        const now = new Date();
        const gapInSeconds = Math.floor((now - user.lastUpdate) / 1000);
        
        // GÜNCELLEME: 4 Saatlik ısınma süresi (100 / (4 * 3600)) = ~0.00694
        const BASE_HEAT_RATE = 100 / (4 * 3600);
        const heatPerSec = BASE_HEAT_RATE / (user.coolingPower || 1);

        if (gapInSeconds > 0 && user.heat < 100) {
            const currentHeat = user.heat;
            const heatNeededToMax = 100 - currentHeat;
            
            // Maksimum ısıya ne kadar sürede ulaşır?
            const secondsUntilOverheat = heatNeededToMax / heatPerSec;

            // Gerçek kazım süresi (Geçen süre veya cihazın ısınana kadar geçirdiği süre)
            const activeMiningSeconds = Math.min(gapInSeconds, secondsUntilOverheat);
            
            // Çevrimdışı kazanç hesabı (0.0005 WLD / saniye)
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

// --- TELEGRAM STARS FATURA OLUŞTURMA ---
app.post('/api/create-stars-invoice', async (req, res) => {
    const { telegramId, type, power, starPrice, title } = req.body;

    try {
        const invoiceUrl = await bot.telegram.createInvoiceLink({
            title: `VoltFarm: ${title}`,
            description: `${title} ile WLD COIN üretim gücünüzü artırın!`,
            payload: JSON.stringify({ telegramId, type, power }),
            provider_token: "", // Stars için boş
            currency: "XTR",     // XTR = Telegram Stars
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
    const { telegramId, type, power } = payload;

    try {
        let user = await User.findOne({ telegramId });
        if (user) {
            if (type === 'gpu') {
                user.gpus += power;
            } else if (type === 'cool') {
                // HTML tarafındaki yeni çarpanlarla uyumlu soğutma gücü artışı
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
    ctx.reply(`🚀 VoltFarm'a Hoş Geldin!\n\nSen kapatsan da GPU'ların WLD COIN kazmaya devam eder, ancak ısınmaya dikkat et!`, 
        Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Madenciliği Başlat', WEBAPP_URL)]
        ])
    );
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

bot.launch().then(() => console.log("Telegram Bot WLD COIN Sürümü Yayında! 🤖"));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});

// Sunucuyu uyandırma döngüsü
setInterval(() => {
    if(WEBAPP_URL) axios.get(WEBAPP_URL).catch(() => {});
}, 600000);
