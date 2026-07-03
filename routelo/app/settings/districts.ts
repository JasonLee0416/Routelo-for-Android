import { FeeSettings } from '../models';

export const SEOUL_DISTRICTS = [
  '강남구',
  '강동구',
  '강북구',
  '강서구',
  '관악구',
  '광진구',
  '구로구',
  '금천구',
  '노원구',
  '도봉구',
  '동대문구',
  '동작구',
  '마포구',
  '서대문구',
  '서초구',
  '성동구',
  '성북구',
  '송파구',
  '양천구',
  '영등포구',
  '용산구',
  '은평구',
  '종로구',
  '중구',
  '중랑구',
] as const;

export const GYEONGGI_DISTRICTS = [
  '가평군',
  '고양시',
  '과천시',
  '광명시',
  '광주시',
  '구리시',
  '군포시',
  '김포시',
  '남양주시',
  '동두천시',
  '부천시',
  '성남시',
  '수원시',
  '시흥시',
  '안산시',
  '안성시',
  '안양시',
  '양주시',
  '양평군',
  '여주시',
  '연천군',
  '오산시',
  '용인시',
  '의왕시',
  '의정부시',
  '이천시',
  '파주시',
  '평택시',
  '포천시',
  '하남시',
  '화성시',
] as const;

export const ALL_DISTRICTS = [...SEOUL_DISTRICTS, ...GYEONGGI_DISTRICTS];

export const DEFAULT_DISTRICT_FEE = 15000;

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  districtFees: Object.fromEntries(
    ALL_DISTRICTS.map((district) => [district, DEFAULT_DISTRICT_FEE]),
  ),
  fuelEfficiency: 12.4,
  themeMode: 'light',
  vehicleModel: '현대 포터2',
  fuelTankCapacity: 65,
};
