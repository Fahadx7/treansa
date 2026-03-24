# Trandsa

منصة تداول ذكية للسوق السعودي مبنية على:
- **React + Vite** للواجهة
- **Express + TypeScript** للـ API والخدمة الخلفية
- **Firebase Auth / Firestore** للمصادقة والبيانات
- **Gemini + Telegram + Yahoo Finance** للتحليل والتنبيهات

## طريقة التشغيل محليًا

```bash
npm install
npm run dev
```

الخادم المحلي يعمل عبر `server.ts` على المنفذ `3000`، والواجهة تُخدم من نفس التطبيق عبر Vite middleware.

## متغيرات البيئة المطلوبة

انسخ `.env.example` إلى `.env` ثم عبّئ القيم:

```bash
GEMINI_API_KEY=
TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=
```

## البناء

```bash
npm run build
```

## النشر الموصى به

هذا المشروع **ليس مناسبًا للنشر على Netlify Functions** بصيغته الحالية، لأن حالة التطبيق والمسح الدوري تحتاج خدمة Node تعمل باستمرار.

المسار الصحيح:
- انشره كخدمة **Web Service** على **Render**
- استخدم `render.yaml` الموجود في المستودع
- اختر **Starter** أو أعلى إذا كنت تريد أن تبقى الخدمة عاملة للتنبيهات والمسح الدوري
- أو اضبط يدويًا:
  - **Build Command:** `npm ci && npm run build`
  - **Start Command:** `npm run start`
  - **Health Check Path:** `/api/health`

## ملاحظات

- لا ترفع ملف `.env`
- تأكد من ضبط قواعد Firebase قبل النشر
- لا تعتمد على `netlify/functions/api.ts` في الإنتاج لهذا المشروع


> ملاحظة تشغيلية: الخطة المجانية في Render لا تصلح هنا إذا كنت تعتمد على المسح الدوري داخل نفس الخدمة، لأن خدمات الويب المجانية تدخل في وضع السكون بعد فترة خمول.
