import CarouselThemes from '@/components/CarouselThemes'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function CarouselThemesSettings() {
  useDocumentTitle('Carousel Themes')
  return <CarouselThemes />
}
