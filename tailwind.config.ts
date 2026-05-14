import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { boxShadow: { glow: "0 0 48px rgba(34, 211, 238, 0.22)" } } },
  plugins: []
};

export default config;
