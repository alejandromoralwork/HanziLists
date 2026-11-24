// @ts-expect-error no types shipped
import Bunzip from 'seek-bzip'

export const bunzip2 = (buf: Buffer): Buffer => Bunzip.decode(buf)
