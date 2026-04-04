// Arabic error messages template — fahad-guardian
export function getArabicError(code) {
  const errors = {
    'auth/unauthorized-domain':      'الدومين غير مصرّح — تواصل مع المطور',
    'auth/operation-not-allowed':    'طريقة الدخول غير مفعّلة',
    'auth/popup-blocked':            'المتصفح حجب نافذة الدخول — اسمح بالنوافذ المنبثقة',
    'auth/network-request-failed':   'مشكلة في الاتصال — حاول مرة أخرى',
    'auth/user-not-found':           'الحساب غير موجود',
    'auth/wrong-password':           'كلمة المرور غير صحيحة',
    'auth/too-many-requests':        'محاولات كثيرة — انتظر دقيقة وحاول',
    'auth/invalid-api-key':          'إعدادات Firebase غير صحيحة',
    'auth/popup-closed-by-user':     null, // silent
  };
  return errors[code] ?? 'حدث خطأ — حاول مرة أخرى';
}
