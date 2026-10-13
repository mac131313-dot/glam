import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Widoczny w sieci lokalnej (Wi-Fi), żeby otworzyć demo na telefonie. API zostaje na 127.0.0.1 –
    // telefon dociera do niego przez proxy poniżej. Wyłączenie: usuń tę linię.
    host: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
