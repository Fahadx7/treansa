# 🛡️ fahad-guardian — سكيل الحماية الشامل

> القاعدة الذهبية: شخّص أولاً، نفّذ ثانياً. لا تقل "تم" إلا بعد تحقق فعلي.

## القواعد الأساسية

1. اقرأ الملف قبل أي تعديل — لا تخمّن
2. عدّل مرة واحدة صح — مو 5 مرات غلط  
3. اجمع التعديلات في commit واحد
4. حد أقصى 3 محاولات لنفس المشكلة ثم أخبر فهد
5. شخّص المشكلة: كود؟ أم إعدادات خارجية؟

## Firebase Checklist
- [ ] Auth provider مفعّل (Google)
- [ ] النطاق مضاف في Authorized Domains
- [ ] projectId + authDomain من نفس المشروع
- [ ] apiKey يطابق المشروع

## أخطاء Auth العربية
| الكود | الرسالة |
|-------|---------|
| unauthorized-domain | الدومين غير مصرّح |
| popup-blocked | اسمح بالنوافذ المنبثقة |
| network-request-failed | تحقق من الإنترنت |
| invalid-api-key | إعدادات Firebase خاطئة |

## Pre-push Checklist
- [ ] `npm run build` ينجح
- [ ] لا API keys في src/
- [ ] `.env` في `.gitignore`
- [ ] Environment vars على Cloudflare Dashboard

## Cloudflare TrandSA
- Production branch: `main`
- Build: `npm run build` + `.npmrc` legacy-peer-deps
- Workers AI binding: `AI`
- Authorized domain: `treansa.aboamran2013.workers.dev`
