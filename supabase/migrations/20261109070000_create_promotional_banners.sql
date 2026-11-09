CREATE TABLE public.promotional_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id uuid NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  subtitle text CHECK (subtitle IS NULL OR char_length(subtitle) <= 180),
  image_path text NOT NULL,
  cta_label text CHECK (cta_label IS NULL OR char_length(cta_label) <= 32),
  destination_type text NOT NULL DEFAULT 'menu'
    CHECK (destination_type IN ('product', 'category', 'vouchers', 'menu', 'custom')),
  destination_id uuid,
  destination_path text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotional_banners_schedule_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT promotional_banners_image_path_check
    CHECK (image_path LIKE cafe_id::text || '/%'),
  CONSTRAINT promotional_banners_destination_check
    CHECK (
      (destination_type IN ('product', 'category') AND destination_id IS NOT NULL AND destination_path IS NULL)
      OR (destination_type IN ('menu', 'vouchers') AND destination_id IS NULL AND destination_path IS NULL)
      OR (
        destination_type = 'custom'
        AND destination_id IS NULL
        AND destination_path IS NOT NULL
        AND destination_path LIKE '/%'
        AND destination_path NOT LIKE '//%'
      )
    )
);

CREATE INDEX promotional_banners_customer_order_idx
  ON public.promotional_banners (cafe_id, sort_order, created_at)
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.validate_promotional_banner_destination()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.destination_type = 'product' AND NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = NEW.destination_id AND cafe_id = NEW.cafe_id
  ) THEN
    RAISE EXCEPTION 'Promotional banner product must belong to the same cafe';
  END IF;

  IF NEW.destination_type = 'category' AND NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = NEW.destination_id AND cafe_id = NEW.cafe_id
  ) THEN
    RAISE EXCEPTION 'Promotional banner category must belong to the same cafe';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER promotional_banners_validate_destination
  BEFORE INSERT OR UPDATE ON public.promotional_banners
  FOR EACH ROW EXECUTE FUNCTION public.validate_promotional_banner_destination();

ALTER TABLE public.promotional_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY promotional_banners_read_active
  ON public.promotional_banners
  FOR SELECT
  TO anon, authenticated
  USING (
    is_active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );

CREATE POLICY promotional_banners_owner_read_all
  ON public.promotional_banners
  FOR SELECT
  TO authenticated
  USING (public.has_cafe_role(cafe_id, ARRAY['owner']::public.app_role[]));

CREATE POLICY promotional_banners_owner_insert
  ON public.promotional_banners
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_cafe_role(cafe_id, ARRAY['owner']::public.app_role[]));

CREATE POLICY promotional_banners_owner_update
  ON public.promotional_banners
  FOR UPDATE
  TO authenticated
  USING (public.has_cafe_role(cafe_id, ARRAY['owner']::public.app_role[]))
  WITH CHECK (public.has_cafe_role(cafe_id, ARRAY['owner']::public.app_role[]));

CREATE POLICY promotional_banners_owner_delete
  ON public.promotional_banners
  FOR DELETE
  TO authenticated
  USING (public.has_cafe_role(cafe_id, ARRAY['owner']::public.app_role[]));

GRANT SELECT ON public.promotional_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promotional_banners TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cafe-banners', 'cafe-banners', true, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY cafe_banners_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'cafe-banners');

CREATE POLICY cafe_banners_owner_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'cafe-banners'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = (SELECT auth.uid())
        AND role = 'owner'
        AND cafe_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY cafe_banners_owner_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'cafe-banners'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = (SELECT auth.uid())
        AND role = 'owner'
        AND cafe_id::text = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'cafe-banners'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = (SELECT auth.uid())
        AND role = 'owner'
        AND cafe_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY cafe_banners_owner_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'cafe-banners'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = (SELECT auth.uid())
        AND role = 'owner'
        AND cafe_id::text = (storage.foldername(name))[1]
    )
  );
