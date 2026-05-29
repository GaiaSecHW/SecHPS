import Image from 'next/image';
import { LOGO_FULL, LOGO_MEDIUM, LOGO_SMALL, PLATFORM_NAME } from '@/lib/branding';

interface ChimeraLogoProps {
  size?: 'full' | 'medium' | 'small';
  className?: string;
}

const logoMap = {
  full: { src: LOGO_FULL, w: 200, h: 200 },
  medium: { src: LOGO_MEDIUM, w: 48, h: 48 },
  small: { src: LOGO_SMALL, w: 32, h: 32 },
};

export default function ChimeraLogo({ size = 'medium', className }: ChimeraLogoProps) {
  const { src, w, h } = logoMap[size];
  return (
    <Image
      src={src}
      alt={PLATFORM_NAME}
      width={w}
      height={h}
      className={className}
      priority={size === 'full'}
    />
  );
}