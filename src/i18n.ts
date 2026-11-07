import type { UniHubErrorCode } from './errors';

export type Locale = 'tr' | 'en';

export const DEFAULT_LOCALE: Locale = 'tr';

/** One message per error code, in every supported locale (SRS NFR-08). */
export const MESSAGES: Record<Locale, Record<UniHubErrorCode, string>> = {
  tr: {
    INVALID_ARGUMENT: 'Geçersiz parametre.',
    KEY_INVALID: 'UniHub anahtarı geçersiz veya devre dışı.',
    ORIGIN_NOT_ALLOWED: 'Bu web sitesi, bu UniHub anahtarını kullanmaya yetkili değil.',
    RATE_LIMITED: 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.',
    NOT_SIGNED_IN: 'Bu işlem için UniHub hesabınızla giriş yapmalısınız.',
    NOT_REGISTERED: 'Bu hesabın bir UniHub profili yok. Önce UniHub’a kayıt olun.',
    EMAIL_NOT_VERIFIED: 'Bu etkinliğe katılmak için e-posta adresinizi doğrulamanız gerekiyor.',
    VERIFIED_MEMBERS_ONLY: 'Bu kulübün etkinliklerine yalnızca e-postası doğrulanmış üyeler katılabilir.',
    MEMBERS_ONLY: 'Bu etkinliğe yalnızca kulübün onaylı üyeleri katılabilir.',
    EVENT_FULL: 'Etkinliğin kontenjanı dolmuştur.',
    EVENT_CLOSED: 'Bu etkinlik için son katılım tarihi geçmiştir.',
    EVENT_NOT_FOUND: 'Etkinlik bulunamadı.',
    ALREADY_JOINED: 'Bu etkinliğe zaten katıldınız.',
    FORM_REQUIRED: 'Bu etkinliğe katılmak için önce başvuru formunu doldurmalısınız.',
    TICKET_UNAVAILABLE: 'Bu etkinlik için biletiniz yok: katılımınız henüz onaylanmadı.',
    APP_REQUIRED: 'Bu etkinliğin başvuru formu belge istiyor; başvuruyu UniHub uygulamasından yapın.',
    SIGN_IN_CANCELLED: 'UniHub ile giriş tamamlanmadı.',
    POPUP_BLOCKED: 'UniHub giriş penceresi açılamadı. Tarayıcınız açılır pencereleri engelliyor olabilir.',
    NETWORK: 'UniHub sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.',
    UNKNOWN: 'Beklenmeyen bir hata oluştu.',
  },
  en: {
    INVALID_ARGUMENT: 'Invalid argument.',
    KEY_INVALID: 'The UniHub key is invalid or disabled.',
    ORIGIN_NOT_ALLOWED: 'This website is not allowed to use this UniHub key.',
    RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
    NOT_SIGNED_IN: 'Sign in with your UniHub account to do this.',
    NOT_REGISTERED: 'This account has no UniHub profile yet. Register with UniHub first.',
    EMAIL_NOT_VERIFIED: 'Verify your email address to join this event.',
    VERIFIED_MEMBERS_ONLY: 'Only members with a verified email can join this club’s events.',
    MEMBERS_ONLY: 'Only approved members of the club can join this event.',
    EVENT_FULL: 'This event is full.',
    EVENT_CLOSED: 'Registration for this event has closed.',
    EVENT_NOT_FOUND: 'Event not found.',
    ALREADY_JOINED: 'You have already joined this event.',
    FORM_REQUIRED: 'This event requires an application form first.',
    TICKET_UNAVAILABLE: 'There is no ticket for you yet: your attendance is not approved.',
    APP_REQUIRED: "This event's application form asks for a document. Apply in the UniHub app.",
    SIGN_IN_CANCELLED: 'UniHub sign-in was not completed.',
    POPUP_BLOCKED: 'The UniHub sign-in window could not be opened. Your browser may be blocking pop-ups.',
    NETWORK: 'Could not reach the UniHub server. Check your internet connection.',
    UNKNOWN: 'An unexpected error occurred.',
  },
};

export function message(code: UniHubErrorCode, locale: Locale = DEFAULT_LOCALE): string {
  return (MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE])[code];
}
