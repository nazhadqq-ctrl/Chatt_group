# ChatFlow - سیستەمی چاتی بێهەمتا 💬

## تەکنەلۆژیاکانی بەکارهاتوو
- **Backend**: Node.js + Express.js
- **Real-time**: Socket.IO
- **Database**: SQL Server (MSSQL)
- **Authentication**: JWT + bcrypt
- **File Upload**: Multer
- **Frontend**: HTML5 + CSS3 + JavaScript

---

## تەیبڵەکانی داتابەیس

| تەیبڵ | کارکرد |
|---|---|
| `users` | زانیاری هەموو یوزەرەکان + ئادمین |
| `group_messages` | مەسەجەکانی چاتی گرووپ |
| `private_messages` | مەسەجەکانی پرایڤەت |
| `user_sessions` | تراکینگی کەسانی دەستەلێکردوو |

---

## چۆنیەتی ڕێکخستن

### ١. کۆپیکردن بۆ سێرڤەر
```bash
# Copy chat-app folder to your server
```

### ٢. دانانی پاکیجەکان
```bash
npm install
```

### ٣. ڕێکخستنی .env
فایلی `.env` بکەرەوە و ئەم گۆڕانکاریانە بکە:
```env
DB_SERVER=62.201.232.190
DB_PORT=1433
DB_DATABASE=ChatAppDB
DB_USER=sa                    ← یوزەرنەیمی SQL Server
DB_PASSWORD=YourPassword       ← پاسوۆردی SQL Server

PORT=3000
JWT_SECRET=change-this-secret-key-to-something-random

ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin@123456   ← پاسوۆردی ئادمین بگۆڕە
ADMIN_EMAIL=admin@yourcompany.com
```

### ٤. دەستپێکردن
```bash
# Development
npm run dev

# Production
npm start
```

---

## تایبەتمەندیەکان

✅ **ریجستەر و لۆگین** - JWT بە پایەی  
✅ **چاتی گرووپ** - بۆ هەموو یوزەرەکان  
✅ **چاتی پرایڤەت** - لەنێوان یوزەرەکان و ئادمین  
✅ **ئاپلۆدی وینە** - PNG, JPG, GIF, WebP  
✅ **ئاپلۆدی دۆکیومێنت** - PDF, Word, Excel, ZIP  
✅ **نیشانەی تایپینگ** - دەبینیت کاتێک کەسێک دەنووسێت  
✅ **ستاتوسی ئۆنلاین** - کێ دەستەلێکردووە  
✅ **نۆتیفیکەیشن** - کاتی پەیامی تازە  
✅ **هەموو مەسەجەکان پاراستراوەن** - ناتوانرێن بسرێنەوە  
✅ **بارکردنی مەسەجی کۆنتر** - scroll بکە بۆ مەسەجی کۆن  

---

## ئادمین
- **Username**: `admin` (یان ئەوەی لە .env دیاری کردووی)
- **Password**: ئەوەی لە .env دیاری کردووی
- ئادمین بە تاجی 👑 دیاردەبێت
- هەموو یوزەرەکان چاتی تایبەتیان لەگەڵ ئادمین هەیە

---

## ئادرەسی ئەپ
```
http://62.201.232.190:3000
```
