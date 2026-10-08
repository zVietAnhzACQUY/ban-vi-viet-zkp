const productImages: Record<string, string> = {
  coffee: "/images/products/ca-phe-dak-lak.webp",
  tea: "/images/products/tra-sen-tay-ho.webp",
  cashew: "/images/products/hat-dieu-binh-phuoc.webp",
  ginger: "/images/products/mut-gung-hue.webp",
  gift: "/images/products/hop-qua-trung-tinh.webp",
  cake: "/images/products/banh-dau-xanh.webp",
  wine: "/images/products/ruou-mo-minh-hoa.webp",
  ricewine: "/images/products/ruou-nep-minh-hoa.webp",
};

export default function Art({
  kind,
  name,
  className = "",
  priority = false,
}: {
  kind: string;
  name: string;
  tone?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      className={"product-art " + className}
      src={productImages[kind] || "/images/products/fallback-product.svg"}
      alt={`Ảnh ${name}`}
      width="900"
      height="720"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = "/images/products/fallback-product.svg";
      }}
    />
  );
}
