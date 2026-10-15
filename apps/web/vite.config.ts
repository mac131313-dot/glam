import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT / API_PORT pozwalają odpalić kilka podglądów naraz (np. z launch.json z autoPort).
    port: Number(process.env.PORT ?? 5173),
    strictPort: !!process.env.PORT,
    // Widoczny w sieci lokalnej (Wi-Fi), żeby otworzyć demo na telefonie. API zostaje na 127.0.0.1 –
    // telefon dociera do niego przez proxy poniżej. Wyłączenie: usuń tę linię.
    host: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3001}` },
  },
});
