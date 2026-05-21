import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
      '3xl': '1920px',
      '4xl': '2560px',
    },
    extend: {
      colors: {
        primary: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#083344',
        },
        zinc: {
          950: '#09090B',
          900: '#18181B',
          800: '#27272A',
          700: '#3F3F46',
          600: '#52525B',
          500: '#71717A',
          400: '#A1A1AA',
          300: '#D4D4D8',
          200: '#E4E4E7',
          100: '#F4F4F5',
        },
        dark: {
          bg: '#09090B',
          surface: '#18181B',
          'surface-hover': '#27272A',
          'surface-alt': '#0F0F12',
          border: '#27272A',
        },
      },
      spacing: {
        'sidebar-collapsed': '64px',
        'sidebar-expanded': '240px',
        'header': '56px',
        'panel-sm': '240px',
        'panel-md': '320px',
        'panel-lg': '400px',
      },
      maxWidth: {
        'prose': '768px',
        'prose-wide': '896px',
        'prose-narrow': '640px',
        'content-sm': '640px',
        'content-md': '768px',
        'content-lg': '1024px',
        'content-xl': '1280px',
        'content-2xl': '1440px',
        'content-4k': '1600px',
        'screen-2xl': '1536px',
      },
      minWidth: {
        'card': '280px',
        'sidebar': '64px',
        'panel': '240px',
      },
      height: {
        'header': '56px',
        'footer': '48px',
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            color: '#d4d4d8',
            '--tw-prose-body': '#d4d4d8',
            '--tw-prose-headings': '#fafafa',
            '--tw-prose-lead': '#a1a1aa',
            '--tw-prose-links': '#22d3ee',
            '--tw-prose-bold': '#fafafa',
            '--tw-prose-counters': '#71717a',
            '--tw-prose-bullets': '#71717a',
            '--tw-prose-hr': '#27272a',
            '--tw-prose-quotes': '#a1a1aa',
            '--tw-prose-quote-borders': '#06b6d4',
            '--tw-prose-captions': '#a1a1aa',
            '--tw-prose-code': '#22d3ee',
            '--tw-prose-pre-code': '#e4e4e7',
            '--tw-prose-pre-bg': '#09090b',
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
            '--tw-prose-invert-quote-borders': '#06b6d4',
            '--tw-prose-invert-captions': '#a1a1aa',
            '--tw-prose-invert-code': '#22d3ee',
            '--tw-prose-invert-pre-code': '#e4e4e7',
            '--tw-prose-invert-pre-bg': '#09090b',
            '--tw-prose-invert-th-borders': '#27272a',
            '--tw-prose-invert-td-borders': '#27272a',
          },
        },
        sm: {
          css: {
            fontSize: '14px',
            lineHeight: '1.6',
          },
        },
        lg: {
          css: {
            fontSize: '18px',
            lineHeight: '1.75',
          },
        },
      },
      animation: {
        'marquee': 'marquee 20s linear infinite',
        'marquee-reverse': 'marquee-reverse 20s linear infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
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
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      transitionProperty: {
        'width': 'width',
        'height': 'height',
        'spacing': 'margin, padding',
        'layout': 'width, height, margin, padding',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(6, 182, 212, 0.15)',
        'glow-strong': '0 0 30px rgba(6, 182, 212, 0.25)',
        'card': '0 1px 2px 0 rgba(0, 0, 0, 0.2), 0 1px 3px 0 rgba(0, 0, 0, 0.15)',
        'card-hover': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.25)',
      },
      borderRadius: {
        'card': '12px',
        'panel': '16px',
      },
    },
  },
  plugins: [
    typography,
  ],
};

export default config;