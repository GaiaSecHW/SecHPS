import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        dark: {
          bg: '#0B1120',
          surface: '#1E293B',
          'surface-hover': '#334155',
          'surface-alt': '#162032',
          border: '#374151',
        },
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': '#d4d4d8',
            '--tw-prose-headings': '#fafafa',
            '--tw-prose-lead': '#a1a1aa',
            '--tw-prose-links': '#22d3ee',
            '--tw-prose-bold': '#fafafa',
            '--tw-prose-counters': '#71717a',
            '--tw-prose-bullets': '#71717a',
            '--tw-prose-hr': '#27272a',
            '--tw-prose-quotes': '#a1a1aa',
            '--tw-prose-quote-borders': '#3b82f6',
            '--tw-prose-captions': '#a1a1aa',
            '--tw-prose-code': '#22d3ee',
            '--tw-prose-pre-code': '#e4e4e7',
            '--tw-prose-pre-bg': '#18181b',
            '--tw-prose-th-borders': '#27272a',
            '--tw-prose-td-borders': '#27272a',
            '--tw-prose-invert-body': '#d4d4d8',
            '--tw-prose-invert-headings': '#fafafa',
            '--tw-prose-invert-lead': '#a1a1aa',
            '--tw-prose-invert-links': '#22d3ee',
            '--tw-prose-invert-bold': '#fafafa',
            '--tw-prose-invert-counters': '#71717a',
            '--tw-prose-invert-bullets': '#71717a',
            '--tw-prose-invert-hr': '#27272a',
            '--tw-prose-invert-quotes': '#a1a1aa',
            '--tw-prose-invert-quote-borders': '#3b82f6',
            '--tw-prose-invert-captions': '#a1a1aa',
            '--tw-prose-invert-code': '#22d3ee',
            '--tw-prose-invert-pre-code': '#e4e4e7',
            '--tw-prose-invert-pre-bg': '#18181b',
            '--tw-prose-invert-th-borders': '#27272a',
            '--tw-prose-invert-td-borders': '#27272a',
          },
        },
      },
      animation: {
        'marquee': 'marquee 20s linear infinite',
        'marquee-reverse': 'marquee-reverse 20s linear infinite',
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'marquee-reverse': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [
    typography,
  ],
};

export default config;
