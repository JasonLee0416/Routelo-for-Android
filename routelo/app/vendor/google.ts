import { VendorCandidate, VendorDirectory } from './types';

export type GoogleVendorConfig = {
  apiKey: string;
  size?: number;
  fetchImpl?: typeof fetch;
};

type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
};

const toCandidate = (place: GooglePlace): VendorCandidate => ({
  name: place.displayName?.text || '',
  phone: place.nationalPhoneNumber || place.internationalPhoneNumber || undefined,
  address: place.formattedAddress || undefined,
  latitude: place.location?.latitude,
  longitude: place.location?.longitude,
  category: place.primaryTypeDisplayName?.text || undefined,
  url: place.googleMapsUri || undefined,
});

export function createGoogleVendorDirectory(
  config: GoogleVendorConfig,
): VendorDirectory {
  const size = config.size ?? 5;
  const doFetch = config.fetchImpl ?? fetch;
  return {
    id: 'google-places',
    async search(query: string): Promise<VendorCandidate[]> {
      const q = query.trim();
      if (!q) return [];

      const res = await doFetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': config.apiKey,
            'X-Goog-FieldMask':
              'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.location,places.primaryTypeDisplayName,places.googleMapsUri',
          },
          body: JSON.stringify({
            textQuery: q,
            languageCode: 'ko',
            regionCode: 'KR',
            maxResultCount: size,
          }),
        },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { places?: GooglePlace[] };
      return (data.places ?? []).map(toCandidate).filter((item) => item.name);
    },
  };
}

export const NULL_VENDOR_DIRECTORY: VendorDirectory = {
  id: 'null',
  async search() {
    return [];
  },
};

export function resolveVendorDirectory(config?: {
  googlePlacesApiKey?: string | null;
  fetchImpl?: typeof fetch;
}): VendorDirectory {
  const key = config?.googlePlacesApiKey?.trim();
  if (!key) return NULL_VENDOR_DIRECTORY;
  return createGoogleVendorDirectory({
    apiKey: key,
    fetchImpl: config?.fetchImpl,
  });
}
