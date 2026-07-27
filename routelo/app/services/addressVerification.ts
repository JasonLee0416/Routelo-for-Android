import { DeliveryOrder, DeliveryDestination } from '../domain';
import { RouteloSettings } from '../settings';
import { findDistrictByAddress } from './maps';

export type AddressVerificationProvider = 'offline-deterministic' | 'google';

export type AddressCandidate = {
  id: string;
  provider: AddressVerificationProvider;
  displayAddress: string;
  latitude: number;
  longitude: number;
  confidence: number;
  district?: string;
  source: 'ocr' | 'manual' | 'geocoded';
};

export type AddressVerificationStatus =
  | 'missing'
  | 'needsReview'
  | 'candidate'
  | 'verified';

export type AddressVerificationResult = {
  status: AddressVerificationStatus;
  inputAddress: string;
  selectedCandidateId?: string;
  candidates: AddressCandidate[];
  warnings: string[];
};

export type VerifiedDestination = DeliveryDestination & {
  addressVerification: AddressVerificationResult;
};

const ADDRESS_REGION_HINT =
  /(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|제주|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남)/u;

const ADDRESS_DETAIL_HINT =
  /(?:[가-힣0-9]+(?:로|길)\s*\d|[가-힣]+(?:동|읍|면|리)\s*\d|(?:빌딩|센터|회관|웨딩|예식장|병원|장례식장|아파트|상가|층|호))/u;

const LABEL_NOISE =
  /(?:tel|hp|전화|연락처|휴대폰|핸드폰|받는\s*분|수령|인수|발주|배송화원|상품|메모|비고)/iu;

function normalizeAddress(address: string) {
  return address.replace(/\s+/g, ' ').trim();
}

function coordinateSeed(address: string) {
  return [...address].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function deterministicCoordinate(address: string, offset = 0) {
  const seed = coordinateSeed(`${address}:${offset}`);
  return {
    latitude: Number((37.45 + ((seed + offset * 17) % 130) / 1000).toFixed(6)),
    longitude: Number((126.85 + ((seed + offset * 23) % 250) / 1000).toFixed(6)),
  };
}

function hasEnoughAddressEvidence(address: string) {
  return ADDRESS_REGION_HINT.test(address) && ADDRESS_DETAIL_HINT.test(address);
}

function candidateId(address: string, index: number) {
  return `addr-${index}-${coordinateSeed(address).toString(36)}`;
}

export function createOfflineAddressCandidates(
  inputAddress: string,
  settings: RouteloSettings,
): AddressVerificationResult {
  const address = normalizeAddress(inputAddress);
  const warnings: string[] = [];

  if (!address) {
    return {
      status: 'missing',
      inputAddress: '',
      candidates: [],
      warnings: ['주소가 없습니다.'],
    };
  }

  if (LABEL_NOISE.test(address)) {
    return {
      status: 'needsReview',
      inputAddress: address,
      candidates: [],
      warnings: ['주소에 라벨·전화번호가 섞여 있어 직접 확인이 필요합니다.'],
    };
  }

  if (!hasEnoughAddressEvidence(address)) {
    warnings.push('주소의 지역·도로·건물 정보가 부족합니다.');
  }

  const district = findDistrictByAddress(address, settings);
  if (!district) warnings.push('등록된 배송 지역과 매칭되지 않았습니다.');

  const firstCoordinate = deterministicCoordinate(address, 0);
  const candidates: AddressCandidate[] = [
    {
      id: candidateId(address, 0),
      provider: 'offline-deterministic',
      displayAddress: address,
      latitude: firstCoordinate.latitude,
      longitude: firstCoordinate.longitude,
      confidence: warnings.length ? 65 : 82,
      district,
      source: 'ocr',
    },
  ];

  if (warnings.length) {
    const secondCoordinate = deterministicCoordinate(address, 1);
    candidates.push({
      id: candidateId(address, 1),
      provider: 'offline-deterministic',
      displayAddress: `${address} (수동 확인 필요)`,
      latitude: secondCoordinate.latitude,
      longitude: secondCoordinate.longitude,
      confidence: 55,
      district,
      source: 'manual',
    });
  }

  return {
    status: candidates.length ? 'candidate' : 'needsReview',
    inputAddress: address,
    candidates,
    warnings,
  };
}

export function selectAddressCandidate(
  result: AddressVerificationResult,
  candidateIdToSelect: string,
): AddressVerificationResult {
  const selected = result.candidates.find(
    (candidate) => candidate.id === candidateIdToSelect,
  );
  if (!selected) return result;
  return {
    ...result,
    selectedCandidateId: selected.id,
    status: 'verified',
  };
}

export function selectedAddressCandidate(
  result?: AddressVerificationResult,
): AddressCandidate | undefined {
  if (!result?.selectedCandidateId) return undefined;
  return result.candidates.find(
    (candidate) => candidate.id === result.selectedCandidateId,
  );
}

export function applyVerifiedAddressToOrder(
  order: DeliveryOrder,
  verification: AddressVerificationResult,
): DeliveryOrder {
  const selected = selectedAddressCandidate(verification);
  if (!selected) return order;
  return {
    ...order,
    destination: {
      ...order.destination,
      address: selected.displayAddress,
      latitude: selected.latitude,
      longitude: selected.longitude,
    },
    settlement: {
      ...order.settlement,
      district: selected.district || order.settlement.district,
    },
  };
}

export function hasTrustedDestination(order: DeliveryOrder) {
  return Boolean(
    order.destination.address &&
      Number.isFinite(order.destination.latitude) &&
      Number.isFinite(order.destination.longitude),
  );
}
