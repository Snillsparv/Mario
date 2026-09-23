// Renders title-logo words at full resolution off the main thread (a big word takes a
// fifth of a second); TitleScreen shows a capped-resolution render until the result lands.
import { renderLogoWord } from './logo.js';

self.onmessage = ({ data: { id, text, opts } }) => {
  const bitmap = renderLogoWord(text, opts).transferToImageBitmap();
  self.postMessage({ id, bitmap }, [bitmap]);
};
