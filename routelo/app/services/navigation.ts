import { Linking } from 'react-native';

import { NavApp } from '../settings';

export const NAV_APP_LABEL: Record<NavApp, string> = {
  google: 'Google Maps',
  tmap: '티맵',
  naver: '네이버 지도',
};

export type NavTarget = {
  name: string;
  latitude: number;
  longitude: number;
};

const APP_PACKAGE = 'com.jasonlee0312.routelo';

// 선택한 내비 앱으로 바로 경로 안내를 띄우는 딥링크.
export function navDeepLink(app: NavApp, target: NavTarget): string {
  const name = encodeURIComponent(target.name);
  const { latitude: lat, longitude: lng } = target;
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    case 'tmap':
      // tmap: goalx=경도(lng), goaly=위도(lat)
      return `tmap://route?goalname=${name}&goalx=${lng}&goaly=${lat}`;
    case 'naver':
      return `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${name}&appname=${APP_PACKAGE}`;
  }
}

// 앱이 설치돼 있지 않을 때의 웹 폴백.
export function navWebFallback(app: NavApp, target: NavTarget): string {
  const name = encodeURIComponent(target.name);
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/search/?api=1&query=${target.latitude},${target.longitude}`;
    case 'naver':
    case 'tmap':
      // 티맵은 웹 길안내가 없어 지도 검색으로 폴백한다.
      return `https://map.naver.com/p/search/${name}`;
  }
}

// 딥링크 시도 → 실패(미설치 등) 시 웹 폴백. 좌표가 없으면 주소 검색으로 안내.
export async function openNavigation(
  app: NavApp,
  target: NavTarget,
): Promise<void> {
  const hasCoords =
    Number.isFinite(target.latitude) &&
    Number.isFinite(target.longitude) &&
    (target.latitude !== 0 || target.longitude !== 0);
  if (hasCoords) {
    try {
      await Linking.openURL(navDeepLink(app, target));
      return;
    } catch {
      // 앱 미설치/스킴 미지원 → 웹 폴백
    }
  }
  await Linking.openURL(navWebFallback(app, target));
}
