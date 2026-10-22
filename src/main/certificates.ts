import type { App } from 'electron';

/**
 * Never presents a client certificate.
 *
 * When a server asks for one, for example while an image from a document is loading, Electron by
 * default uses the first certificate in the user's Windows certificate store without asking. A
 * hostile document could point an image at its own server and learn who the reader is (name,
 * e-mail, issuer). MD Reader has no use for client certificates, so it offers none.
 */
export function declineClientCertificates(app: Pick<App, 'on'>): void {
  app.on('select-client-certificate', (event, _webContents, _url, _certificates, callback) => {
    event.preventDefault();
    callback();
  });
}
