import Image from "next/image";
import type { Organization } from "@/lib/database.types";

interface OrgHighlightProps {
  organization: Organization;
}

export default function OrgHighlight({ organization }: OrgHighlightProps) {
  if (!organization.highlight_product_name) {
    return null;
  }

  return (
    <section>
      <h2 className="text-2xl font-bold text-[#1A1A1A] mb-6">Featured</h2>

      <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Product Image */}
          {organization.highlight_photo && (
            <div className="md:w-1/2 aspect-video md:aspect-square relative">
              <Image
                src={organization.highlight_photo}
                alt={organization.highlight_product_name || "Featured product"}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          )}

          {/* Product Info */}
          <div className={`p-8 flex flex-col justify-center ${
            organization.highlight_photo ? "md:w-1/2" : "w-full"
          }`}>
            <span className="text-sm font-medium text-[#D60001] uppercase tracking-wider mb-2">
              Featured
            </span>
            <h3 className="text-2xl font-bold text-[#1A1A1A] mb-3">
              {organization.highlight_product_name}
            </h3>

            {organization.highlight_product_description && (
              <p className="text-[#6B6B6B] leading-relaxed">
                {organization.highlight_product_description}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
