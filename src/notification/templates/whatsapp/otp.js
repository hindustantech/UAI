export function otpWhatsApp({ name, code, expiryMinutes }) {
  return {
    message: `Your UAI verification code is ${code || '000000'}. It expires in ${expiryMinutes || '10'} minutes. Do not share this code with anyone.`,
    params: [String(code || '000000'), String(expiryMinutes || '10')],
  };
}
