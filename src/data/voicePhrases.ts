/**
 * Everything AwazPay says, in one place.
 *
 * Each line exists in three variants because of a hard browser constraint: a
 * real Urdu synthesis voice is installed on very few desktops. So:
 *
 *   ur     Urdu script. Used only when an actual ur-* voice is installed,
 *          because an English voice cannot pronounce Urdu script at all.
 *   roman  Roman Urdu. Used when the user has chosen Urdu but no Urdu voice
 *          exists. An English voice reads this close enough to be understood,
 *          which keeps the Urdu-first experience working everywhere.
 *   en     English. Used only when the user selects an English voice.
 *
 * voiceOutputService.resolvePhrase picks the variant; callers just pass the
 * phrase. Amounts are written as digits rather than spelled out, so the
 * synthesiser reads them in whatever language it is speaking.
 */

export interface Phrase {
  ur: string
  roman: string
  en: string
}

export function phrase(ur: string, roman: string, en: string): Phrase {
  return { ur, roman, en }
}

/** Joins phrases into one utterance, variant by variant. */
export function joinPhrases(...parts: Phrase[]): Phrase {
  return {
    ur: parts.map((p) => p.ur).join(' '),
    roman: parts.map((p) => p.roman).join(' '),
    en: parts.map((p) => p.en).join(' '),
  }
}

export function plain(text: string): Phrase {
  return { ur: text, roman: text, en: text }
}

/** Renders a money amount for speech. Digits, so each voice reads its own way. */
export function money(amount: number): Phrase {
  const n = amount.toLocaleString('en-US')
  return {
    ur: `${n} روپے`,
    roman: `${n} rupay`,
    en: `${n} rupees`,
  }
}

/** Interpolates `{amount}`, `{name}`, `{number}` and `{count}` placeholders. */
export function fill(template: Phrase, values: Record<string, string | number | Phrase>): Phrase {
  const variants: Array<keyof Phrase> = ['ur', 'roman', 'en']
  const out = { ...template }
  for (const variant of variants) {
    let text = template[variant]
    for (const [key, value] of Object.entries(values)) {
      const replacement =
        typeof value === 'object' && value !== null && 'ur' in value ? value[variant] : String(value)
      text = text.split(`{${key}}`).join(replacement)
    }
    out[variant] = text
  }
  return out
}

// ---------------------------------------------------------------- session

export const PHRASES = {
  welcome: phrase(
    'خوش آمدید۔ میں آواز پے ہوں۔ شروع کرنے کے لیے کہیے، ہے آواز پے۔',
    'Khush aamdeed. Main AwazPay hoon. Shuru karne ke liye kahiye, Hey AwazPay.',
    'Welcome to AwazPay. To begin, say Hey AwazPay.',
  ),
  ready: phrase(
    'آواز پے تیار ہے۔ کہیے، ہے آواز پے۔',
    'AwazPay tayyar hai. Kahiye, Hey AwazPay.',
    'AwazPay is ready. Say Hey AwazPay.',
  ),
  wakeAcknowledged: phrase('جی، میں سن رہا ہوں۔', 'Ji, main sun raha hoon.', 'Yes, I am listening.'),
  notUnderstood: phrase(
    'معاف کیجیے، میں سمجھ نہیں سکا۔ مدد کے لیے کہیے، مدد۔',
    'Maaf kijiye, main samajh nahin saka. Madad ke liye kahiye, madad.',
    "Sorry, I didn't understand that. Say help for a list of commands.",
  ),
  help: phrase(
    'آپ کہہ سکتے ہیں: ایک، دو، تین، چار یا پانچ۔ یا کسی بھی وقت کہیے، منسوخ کرو۔',
    'Aap keh sakte hain: ek, do, teen, char ya paanch. Ya kisi bhi waqt kahiye, cancel karo.',
    'Say a number from one to five to choose an option. Say menu to hear the list again, or say cancel at any time.',
  ),

  /**
   * The spoken main menu.
   *
   * Numbered because a number is the shortest, most reliably recognised
   * thing a person can say, and because it does not depend on the user
   * remembering any particular phrasing. This is the primary way a blind
   * user navigates AwazPay; the on-screen list mirrors it.
   */
  menu: phrase(
    'کہیے ایک، این ایف سی سے ادائیگی کے لیے۔ کہیے دو، کسی کو رقم بھیجنے کے لیے۔ کہیے تین، اپنا بیلنس سننے کے لیے۔ کہیے چار، اپنی حالیہ ٹرانزیکشنز کے لیے۔ کہیے پانچ، کیش جمع کرنے کے لیے۔',
    'Kahiye ek, NFC se payment ke liye. Kahiye do, kisi ko paise bhejne ke liye. Kahiye teen, apna balance sunne ke liye. Kahiye char, apni account activity ke liye. Kahiye paanch, cash deposit ke liye.',
    'Say 1 for N F C payment. Say 2 to transfer money to someone. Say 3 to check your balance. Say 4 for your account activity. Say 5 for cash deposit.',
  ),

  menuIntro: phrase(
    'آواز پے تیار ہے۔',
    'AwazPay tayyar hai.',
    'AwazPay is ready.',
  ),

  menuRepeat: phrase('دوبارہ سنیے۔', 'Dobara suniye.', 'Here are your options again.'),

  // ------------------------------------------- spoken secret word setup
  askSecretWord: phrase(
    'اب اپنا خفیہ لفظ بولیے۔ یہ ایک لفظ ہونا چاہیے جو صرف آپ جانتے ہوں۔',
    'Ab apna secret word boliye. Yeh aik lafz hona chahiye jo sirf aap jante hon.',
    'Now say your secret word. Choose a single word that only you would know. Say it after the tone.',
  ),
  confirmSecretWord: fill(
    phrase(
      'میں نے سنا {word}۔ تصدیق کے لیے کہیے ہاں، یا دوبارہ کہنے کے لیے کہیے نہیں۔',
      'Main ne suna {word}. Tasdeeq ke liye kahiye haan, ya dobara kehne ke liye kahiye nahi.',
      'I heard {word}. Say yes to confirm, or say no to choose a different word.',
    ),
    {},
  ),
  secretWordSaved: fill(
    phrase(
      'آپ کا خفیہ لفظ محفوظ ہو گیا۔ ہر ادائیگی سے پہلے میں آپ سے {word} اور ایک نمبر مانگوں گا۔',
      'Aapka secret word mehfooz ho gaya. Har payment se pehle main aapse {word} aur aik number mangunga.',
      'Your secret word is saved. Before every payment I will ask you to say {word} followed by a random number.',
    ),
    {},
  ),
  secretWordNotHeard: phrase(
    'میں خفیہ لفظ نہیں سن سکا۔ براہ کرم ایک لفظ صاف بولیے۔',
    'Main secret word nahin sun saka. Barah-e-karam aik lafz saaf boliye.',
    "I didn't catch your secret word. Please say a single word clearly.",
  ),
  // ------------------------------------------------- greetings, small talk
  greeting: phrase(
    'السلام علیکم! میں آواز پے ہوں۔ میں آپ کی ڈیجیٹل بینکنگ میں مدد کے لیے تیار ہوں۔',
    'Assalam-o-Alaikum! Main AwazPay hoon. Main aapki digital banking mein madad ke liye tayyar hoon.',
    'Hello. I am AwazPay. I am ready to help you with your banking.',
  ),
  howAreYou: phrase(
    'میں بالکل ٹھیک ہوں، شکریہ۔ بتائیے، میں آپ کی کیا مدد کر سکتا ہوں؟',
    'Main bilkul theek hoon, shukriya. Bataiye, main aapki kya madad kar sakta hoon?',
    'I am well, thank you. How can I help you today?',
  ),
  capabilities: phrase(
    'میں بیلنس چیک کرنے، پیمنٹ، موبائل لوڈ، این ایف سی پیمنٹ اور ٹرانزیکشن میں آپ کی مدد کر سکتا ہوں۔',
    'Main balance check karne, payments, mobile load, NFC payment aur transaction assistance mein aapki madad kar sakta hoon.',
    'I can help you check your balance, make payments, top up your mobile, pay by N F C, and review transactions.',
  ),
  thanks: phrase(
    'کوئی بات نہیں۔ میں حاضر ہوں۔',
    'Koi baat nahin. Main hazir hoon.',
    'You are welcome. I am here whenever you need me.',
  ),

  // --------------------------------------------- uncertainty and confirming
  lowConfidence: phrase(
    'میں آپ کی بات صاف نہیں سمجھ سکا۔ براہ کرم دوبارہ بتائیں۔',
    'Main aapki request clearly samajh nahin saka. Barah-e-karam dobara batayein.',
    'I did not catch that clearly. Please say it again.',
  ),
  amountUnclear: phrase(
    'میں رقم صاف نہیں سمجھ سکا۔ براہ کرم رقم دوبارہ بتائیں۔',
    'Main amount clearly samajh nahin saka. Barah-e-karam amount dobara batayein.',
    'I did not catch the amount clearly. Please say the amount again.',
  ),
  confirmUnderstanding: fill(
    phrase(
      'میں نے سمجھا ہے کہ آپ {name} کو {amount} بھیجنا چاہتے ہیں۔ کیا یہ ٹھیک ہے؟',
      'Main ne samjha hai ke aap {name} ko {amount} bhejna chahte hain. Kya yeh theek hai?',
      'I understood that you want to send {amount} to {name}. Is that correct?',
    ),
    {},
  ),
  confirmUnderstandingTopUp: fill(
    phrase(
      'میں نے سمجھا ہے کہ آپ {amount} کا موبائل لوڈ کرنا چاہتے ہیں۔ کیا یہ ٹھیک ہے؟',
      'Main ne samjha hai ke aap {amount} ka mobile load karna chahte hain. Kya yeh theek hai?',
      'I understood that you want a mobile top-up of {amount}. Is that correct?',
    ),
    {},
  ),
  understoodCancelled: phrase(
    'ٹھیک ہے، میں نے منسوخ کر دیا۔ دوبارہ بتائیے۔',
    'Theek hai, main ne cancel kar diya. Dobara bataiye.',
    'All right, I have cancelled that. Please tell me again.',
  ),

  listeningResumed: phrase('میں سن رہا ہوں۔', 'Main sun raha hoon.', 'I am listening.'),
  stoppedListening: phrase(
    'آواز پے نے سننا بند کر دیا ہے۔ دوبارہ شروع کرنے کے لیے مائیک کا بٹن دبائیں۔',
    'AwazPay ne sunna band kar diya hai. Dobara shuru karne ke liye mic ka button dabayein.',
    'AwazPay has stopped listening. Use the microphone button to start again.',
  ),

  // ------------------------------------------------------------- permission
  micNeeded: phrase(
    'آواز پے کو آپ کی آواز سننے کی اجازت چاہیے۔ وائس موڈ آن کرنے کا بٹن دبائیں۔',
    'AwazPay ko aapki awaaz sunne ki ijazat chahiye. Voice mode on karne ka button dabayein.',
    'AwazPay needs permission to hear you. Please press the enable voice mode button.',
  ),
  micGranted: phrase(
    'وائس موڈ فعال ہو گیا ہے۔ اب آپ کسی بھی وقت کہہ سکتے ہیں، ہے آواز پے۔',
    'Voice mode faal ho gaya hai. Ab aap kisi bhi waqt keh sakte hain, Hey AwazPay.',
    'Voice mode is active. You can now say Hey AwazPay at any time.',
  ),
  micDenied: phrase(
    'مائیکروفون کی اجازت نہیں ملی۔ براہ کرم براؤزر میں اجازت دیں، یا اسکرین کے بٹن استعمال کریں۔',
    'Microphone ki ijazat nahin mili. Barah-e-karam browser mein ijazat dein, ya screen ke buttons istemal karein.',
    'Microphone access was denied. Please allow it in your browser, or use the on-screen buttons.',
  ),
  sttUnsupported: phrase(
    'یہ براؤزر آواز پہچاننے کی سہولت نہیں دیتا۔ براہ کرم کروم استعمال کریں، یا اسکرین کے بٹن استعمال کریں۔',
    'Yeh browser awaaz pehchanne ki sahulat nahin deta. Barah-e-karam Chrome istemal karein, ya screen ke buttons istemal karein.',
    'This browser cannot recognise speech. Please use Chrome, or use the on-screen buttons.',
  ),
  micLost: phrase(
    'مائیکروفون سے رابطہ ٹوٹ گیا ہے۔ اسکرین کے بٹن استعمال کریں یا دوبارہ کوشش کریں۔',
    'Microphone se rabta toot gaya hai. Screen ke buttons istemal karein ya dobara koshish karein.',
    'The microphone connection was lost. Use the on-screen buttons, or try again.',
  ),

  // ---------------------------------------------------------------- balance
  balancePrivate: fill(
    phrase(
      'آپ کا بیلنس {amount} ہے۔ یہ صرف آواز کے ذریعے بتایا جا رہا ہے۔',
      'Aapka balance {amount} hai. Yeh sirf audio ke zariye bataya ja raha hai.',
      'Your balance is {amount}. It is being delivered privately by voice.',
    ),
    {},
  ),

  // ---------------------------------------------------------------- payment
  paymentIntro: phrase(
    'پیمنٹ۔ تفصیلات صرف آواز کے ذریعے بتائی جائیں گی۔',
    'Payment. Tafseelat sirf audio ke zariye batayi jayengi.',
    'Payment. Your details will be delivered privately by voice.',
  ),
  askAmountPay: phrase(
    'کتنے روپے بھیجنے ہیں؟ رقم بتائیے۔',
    'Kitne rupay bhejne hain? Raqam bataiye.',
    'How much would you like to pay? Please say the amount.',
  ),
  askAmountLoad: phrase(
    'کتنے کا لوڈ کرنا ہے؟ رقم بتائیے۔',
    'Kitne ka load karna hai? Raqam bataiye.',
    'How much would you like to load? Please say the amount.',
  ),
  askAmountDeposit: phrase(
    'کتنے روپے جمع کرنے ہیں؟ رقم بتائیے۔',
    'Kitne rupay jama karne hain? Raqam bataiye.',
    'How much would you like to deposit? Please say the amount.',
  ),
  askAmountRetry: phrase(
    'رقم سمجھ نہیں آئی۔ مثال کے طور پر کہیے، پانچ سو روپے۔',
    'Raqam samajh nahin aayi. Misaal ke taur par kahiye, paanch sau rupay.',
    "I didn't catch the amount. For example, say five hundred rupees.",
  ),
  askRecipient: phrase(
    'کس کو بھیجنا ہے؟ نام بتائیے۔',
    'Kis ko bhejna hai? Naam bataiye.',
    'Who would you like to pay? Please say the name.',
  ),
  askRecipientRetry: phrase(
    'نام سمجھ نہیں آیا۔ دوبارہ نام بتائیے۔',
    'Naam samajh nahin aaya. Dobara naam bataiye.',
    "I didn't catch the name. Please say the name again.",
  ),
  reviewPayment: fill(
    phrase(
      'آپ {name} کو {amount} بھیجنا چاہتے ہیں۔ روکنے کے لیے کسی بھی وقت کہیے، منسوخ کرو۔',
      'Aap {name} ko {amount} bhejna chahte hain. Rokne ke liye kisi bhi waqt kahiye, cancel karo.',
      'You are about to pay {amount} to {name}. Say cancel at any time to stop.',
    ),
    {},
  ),
  reviewTopUp: fill(
    phrase(
      'آپ {number} پر {amount} کا لوڈ کرنا چاہتے ہیں۔ روکنے کے لیے کہیے، منسوخ کرو۔',
      'Aap {number} par {amount} ka load karna chahte hain. Rokne ke liye kahiye, cancel karo.',
      'You are about to load {amount} to {number}. Say cancel to stop.',
    ),
    {},
  ),
  reviewDeposit: fill(
    phrase(
      'آپ {amount} کیش جمع کرنا چاہتے ہیں۔ روکنے کے لیے کہیے، منسوخ کرو۔',
      'Aap {amount} cash jama karna chahte hain. Rokne ke liye kahiye, cancel karo.',
      'You are about to deposit {amount} in cash. Say cancel to stop.',
    ),
    {},
  ),

  // ----------------------------------------------------------- verification
  challenge: fill(
    phrase(
      'تصدیق کے لیے، اپنا خفیہ لفظ بولیے اور اس کے بعد نمبر {number}۔',
      'Tasdeeq ke liye, apna secret word boliye aur uske baad number {number}.',
      'For security, please say your secret word followed by the number {number}.',
    ),
    {},
  ),
  challengeRetry: phrase(
    'تصدیق درست نہیں تھی۔ نیا سیکیورٹی نمبر دے رہا ہوں۔',
    'Tasdeeq durust nahin thi. Naya security number de raha hoon.',
    'That did not match. Here is a new security number.',
  ),
  challengeFailed: phrase(
    'تصدیق ناکام رہی۔ آپ کی حفاظت کے لیے یہ ٹرانزیکشن منسوخ کر دی گئی ہے۔',
    'Tasdeeq nakaam rahi. Aapki hifazat ke liye yeh transaction cancel kar di gayi hai.',
    'Verification was not successful. For your security, this transaction has been cancelled.',
  ),
  confirmPayment: fill(
    phrase(
      'تصدیق کامیاب۔ {name} کو {amount} بھیجنے کے لیے کہیے، تصدیق۔',
      'Tasdeeq kamyab. {name} ko {amount} bhejne ke liye kahiye, confirm.',
      'Verification successful. To pay {amount} to {name}, say confirm.',
    ),
    {},
  ),
  confirmTopUp: fill(
    phrase(
      'تصدیق کامیاب۔ {amount} کا لوڈ مکمل کرنے کے لیے کہیے، تصدیق۔',
      'Tasdeeq kamyab. {amount} ka load mukammal karne ke liye kahiye, confirm.',
      'Verification successful. To complete this top-up of {amount}, say confirm.',
    ),
    {},
  ),
  confirmDeposit: fill(
    phrase(
      '{amount} کیش ڈپازٹ کی تصدیق کے لیے کہیے، تصدیق۔',
      '{amount} cash deposit ki tasdeeq ke liye kahiye, confirm.',
      'To confirm your cash deposit of {amount}, say confirm.',
    ),
    {},
  ),
  confirmNotHeard: phrase(
    'تصدیق سنائی نہیں دی۔ جاری رکھنے کے لیے کہیے تصدیق، یا روکنے کے لیے کہیے منسوخ کرو۔',
    'Tasdeeq sunayi nahin di. Jari rakhne ke liye kahiye confirm, ya rokne ke liye kahiye cancel karo.',
    'I did not hear a confirmation. Say confirm to continue, or cancel to stop.',
  ),

  // --------------------------------------------------------- trusted circle
  trustedRequested: fill(
    phrase(
      'یہ رقم آپ کی حد سے زیادہ ہے، اس لیے اضافی تصدیق درکار ہے۔ {name} کو منظوری کی درخواست بھیج دی گئی ہے۔ یہ ایک نقلی ٹرسٹڈ سرکل اجازت ہے۔',
      'Yeh raqam aapki had se ziada hai, is liye izafi tasdeeq darkar hai. {name} ko manzoori ki darkhwast bhej di gayi hai. Yeh aik simulated Trusted Circle authorization hai.',
      'This amount is above your standard limit, so additional verification is required. An approval request has been sent to {name}. This is a simulated Trusted Circle authorization.',
    ),
    {},
  ),
  trustedApproved: fill(
    phrase(
      '{name} نے منظوری دے دی ہے۔ اضافی تصدیق مکمل ہو گئی۔',
      '{name} ne manzoori de di hai. Izafi tasdeeq mukammal ho gayi.',
      '{name} approved this transaction. Additional verification is complete.',
    ),
    {},
  ),
  trustedMissing: phrase(
    'یہ رقم آپ کی حد سے زیادہ ہے اور ٹرسٹڈ سرکل کی منظوری درکار ہے، مگر آپ نے ابھی کوئی بھروسے کا فرد شامل نہیں کیا۔ ٹرانزیکشن منسوخ کر دی گئی ہے۔',
    'Yeh raqam aapki had se ziada hai aur Trusted Circle ki manzoori darkar hai, magar aap ne abhi koi bharose ka fard shamil nahin kiya. Transaction cancel kar di gayi hai.',
    'This amount is above your limit and needs Trusted Circle approval, but you have not added anyone yet. The transaction has been cancelled.',
  ),

  // ---------------------------------------------------------------- results
  paymentSuccess: fill(
    phrase(
      'آپ کی پیمنٹ کامیابی سے مکمل ہو گئی ہے۔ {name} کو {amount} بھیج دیے گئے۔ باقی بیلنس {balance} ہے۔ یہ ایک نقلی ٹرانزیکشن تھی۔',
      'Aapki payment kamyabi se complete ho gayi hai. {name} ko {amount} bhej diye gaye. Baqi balance {balance} hai. Yeh aik simulated transaction thi.',
      'Your payment is complete. {amount} was paid to {name}. Your remaining balance is {balance}. This was a simulated transaction.',
    ),
    {},
  ),
  topUpSuccess: fill(
    phrase(
      'آپ کا موبائل لوڈ کامیاب رہا۔ {number} پر {amount} لوڈ ہو گئے۔ باقی بیلنس {balance} ہے۔ یہ ایک نقلی ٹرانزیکشن تھی۔',
      'Aapka mobile load kamyab raha. {number} par {amount} load ho gaye. Baqi balance {balance} hai. Yeh aik simulated transaction thi.',
      'Your top-up is complete. {amount} was loaded to {number}. Your remaining balance is {balance}. This was a simulated transaction.',
    ),
    {},
  ),
  topUpProcessing: phrase(
    'آپ کا موبائل لوڈ پروسیس ہو رہا ہے۔',
    'Aapka mobile load process ho raha hai.',
    'Your mobile top-up is being processed.',
  ),
  depositSuccess: fill(
    phrase(
      'آپ کا کیش ڈپازٹ کامیابی سے تصدیق ہو گیا ہے۔ {amount} آپ کے اکاؤنٹ میں شامل کر دیے گئے۔ نیا بیلنس {balance} ہے۔ یہ ایک نقلی ٹرانزیکشن تھی۔',
      'Aapka cash deposit kamyabi se tasdeeq ho gaya hai. {amount} aapke account mein shamil kar diye gaye. Naya balance {balance} hai. Yeh aik simulated transaction thi.',
      'Your cash deposit has been successfully confirmed. {amount} was added to your account. Your new balance is {balance}. This was a simulated transaction.',
    ),
    {},
  ),
  cancelled: phrase(
    'ٹرانزیکشن منسوخ کر دی گئی ہے۔ کوئی رقم منتقل نہیں ہوئی۔',
    'Transaction cancel kar di gayi hai. Koi raqam muntaqil nahin hui.',
    'The transaction has been cancelled. No money was transferred.',
  ),
  insufficient: phrase(
    'آپ کا بیلنس اس ٹرانزیکشن کے لیے کافی نہیں ہے۔ ٹرانزیکشن منسوخ کر دی گئی ہے۔',
    'Aapka balance is transaction ke liye kaafi nahin hai. Transaction cancel kar di gayi hai.',
    'Your balance is not sufficient for this transaction. It has been cancelled.',
  ),
  invalidAmount: phrase(
    'درست رقم سمجھ نہیں آئی۔ مثال کے طور پر کہیے، پانچ سو روپے۔',
    'Durust raqam samajh nahin aayi. Misaal ke taur par kahiye, paanch sau rupay.',
    "I couldn't read a valid amount. For example, say five hundred rupees.",
  ),
  amountGiveUp: phrase(
    'رقم سمجھ نہیں آ سکی۔ ٹرانزیکشن منسوخ کر دی گئی ہے۔ آپ اسکرین کے بٹن بھی استعمال کر سکتے ہیں۔',
    'Raqam samajh nahin aa saki. Transaction cancel kar di gayi hai. Aap screen ke buttons bhi istemal kar sakte hain.',
    "I couldn't understand the amount. The transaction was cancelled. You can also use the on-screen buttons.",
  ),
  nameGiveUp: phrase(
    'نام سمجھ نہیں آ سکا۔ ٹرانزیکشن منسوخ کر دی گئی ہے۔',
    'Naam samajh nahin aa saka. Transaction cancel kar di gayi hai.',
    "I couldn't understand the name. The transaction was cancelled.",
  ),

  // ------------------------------------------------------------ cash assist
  depositGuidance: phrase(
    'کیش ڈپازٹ کے لیے اپنے بھروسے کے فرد کو ساتھ لے کر مجاز مقام پر جائیں۔',
    'Cash deposit ke liye apne trusted person ko saath le kar authorized location par jayein.',
    'For a cash deposit, please go to an authorised location with a trusted person where required.',
  ),

  // -------------------------------------------------------------------- NFC
  nfcBringPhone: phrase(
    'اپنا فون پیمنٹ ٹرمینل کے قریب لے جائیں۔',
    'Apna phone payment terminal ke qareeb le jayein.',
    'Please hold your phone near the payment terminal.',
  ),
  nfcDetected: phrase(
    'پیمنٹ ٹرمینل ڈیٹیکٹ ہو گیا ہے۔',
    'Payment terminal detect ho gaya hai.',
    'Payment terminal detected.',
  ),
  nfcSimulatedNote: phrase(
    'یاد رہے، یہ این ایف سی صرف ڈیمو کے لیے ہے۔',
    'Yaad rahe, yeh NFC sirf demo ke liye hai.',
    'Please note, this N F C payment is simulated for the demo.',
  ),

  // ------------------------------------------------------------- navigation
  openingHome: phrase('ہوم اسکرین کھول رہا ہوں۔', 'Home screen khol raha hoon.', 'Opening the home screen.'),
  openingActivity: phrase('ایکٹیویٹی کھول رہا ہوں۔', 'Activity khol raha hoon.', 'Opening your activity.'),
  openingTrusted: phrase('ٹرسٹڈ سرکل کھول رہا ہوں۔', 'Trusted Circle khol raha hoon.', 'Opening your Trusted Circle.'),
  openingSettings: phrase('سیٹنگز کھول رہا ہوں۔', 'Settings khol raha hoon.', 'Opening settings.'),
  openingReceive: phrase('پیسے وصول کرنے کا موڈ کھول رہا ہوں۔', 'Paise wasool karne ka mode khol raha hoon.', 'Opening receive money.'),
  goingBack: phrase('واپس جا رہا ہوں۔', 'Wapas ja raha hoon.', 'Going back.'),
  nothingToCancel: phrase(
    'اس وقت منسوخ کرنے کے لیے کچھ نہیں ہے۔',
    'Is waqt cancel karne ke liye kuch nahin hai.',
    'There is nothing to cancel right now.',
  ),
  noTransactions: phrase('ابھی کوئی ٹرانزیکشن نہیں ہے۔', 'Abhi koi transaction nahin hai.', 'You have no transactions yet.'),
  historyPrivate: phrase(
    'آپ کی حالیہ ٹرانزیکشنز صرف آواز کے ذریعے بتائی جا رہی ہیں۔',
    'Aapki haaliya transactions sirf audio ke zariye batayi ja rahi hain.',
    'Your recent transactions are being delivered privately by voice.',
  ),
} as const

/** Describes a transaction for the history readout. */
export function describeTransactionPhrase(
  direction: 'sent' | 'received' | 'topup' | 'deposit',
  amount: number,
  counterparty: string,
): Phrase {
  const amt = money(amount)
  switch (direction) {
    case 'received':
      return fill(
        phrase('{name} سے {amount} موصول ہوئے۔', '{name} se {amount} wasool hue.', 'You received {amount} from {name}.'),
        { name: counterparty, amount: amt },
      )
    case 'sent':
      return fill(
        phrase('{name} کو {amount} بھیجے۔', '{name} ko {amount} bheje.', 'You sent {amount} to {name}.'),
        { name: counterparty, amount: amt },
      )
    case 'topup':
      return fill(phrase('{amount} کا موبائل لوڈ کیا۔', '{amount} ka mobile load kiya.', 'You loaded {amount} as a mobile top-up.'), {
        amount: amt,
      })
    case 'deposit':
    default:
      return fill(phrase('{amount} کیش جمع کیے۔', '{amount} cash jama kiye.', 'You deposited {amount} in cash.'), {
        amount: amt,
      })
  }
}
