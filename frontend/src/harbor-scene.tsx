import { useId } from 'react';

/** Original harbor geometry shared by the two authentication moments. */
export function HarborScene({ dawn }: { dawn: boolean }) {
  const id = useId().replaceAll(':', '');
  const palette = dawn
    ? { sky: '#b5c5cf', horizon: '#efd2ad', water: '#7095a5', foreground: '#284c62', rock: '#385366', tower: '#dfd9c8', roof: '#34495b', light: '#ffe7ba' }
    : { sky: '#081422', horizon: '#23394a', water: '#102b3d', foreground: '#091c2b', rock: '#142f40', tower: '#809398', roof: '#10202c', light: '#ffe7a9' };
  const geometry = (prefix: string) => <>
    <defs>
      <linearGradient id={`${prefix}-sky`} x2="0" y2="1"><stop stopColor={palette.sky}/><stop offset="1" stopColor={palette.horizon}/></linearGradient>
      <linearGradient id={`${prefix}-sea`} x2="0" y2="1"><stop stopColor={palette.water}/><stop offset="1" stopColor={palette.foreground}/></linearGradient>
      <linearGradient id={`${prefix}-beam`}><stop stopColor={palette.light} stopOpacity=".24"/><stop offset="1" stopColor={palette.light} stopOpacity="0"/></linearGradient>
      <linearGradient id={`${prefix}-mist`} x2="1" y2="0"><stop stopColor={palette.horizon} stopOpacity="0"/><stop offset=".5" stopColor={palette.horizon} stopOpacity=".14"/><stop offset="1" stopColor={palette.horizon} stopOpacity="0"/></linearGradient>
    </defs>
    <path fill={`url(#${prefix}-sky)`} d="M0 0H1400V610H0z"/>
    <path fill={dawn ? '#79929f' : '#1b3341'} d="M0 494 75 480 110 485 150 464 206 467 236 447 285 453 326 479 375 473 415 494 469 493 507 479 545 485 592 471 650 485 705 477 745 488 815 469 867 487 950 475 1001 490 1055 486 1100 498 1190 482 1260 491 1320 477 1400 483V619H0z"/>
    <path fill={dawn ? '#8ca2a9' : '#152b3a'} d="M0 520H1400V1000H0z"/>
    <path fill={`url(#${prefix}-sea)`} d="M0 539Q420 521 650 540T1400 535V1000H0z"/>
    <path stroke={dawn ? '#c1b79f' : '#68746c'} strokeWidth="2" fill="none" opacity=".35" d="M0 540Q380 521 650 540T1400 535"/>
    <path fill={`url(#${prefix}-mist)`} d="M0 504H1400V610H0z"/>
    <g fill={palette.light} opacity={dawn ? '.5' : '.85'}>{[[130,503],[192,495],[485,502],[598,500],[714,503],[895,500],[1035,505]].map(([x,y])=><rect key={x} x={x} y={y} width="3" height="2" rx="1"/>)}</g>
    <path fill={palette.rock} d="M0 731 70 719 139 695 207 682 271 642 327 625 388 615 435 601 487 605 523 617 552 628 617 632 663 647 701 650 757 669 797 691 856 702 900 722 941 729 1022 763 1002 794 918 785 809 758 704 737 606 727 505 709 413 706 314 716 220 737 110 787 0 821z"/>
    <path fill={palette.foreground} d="M0 764 134 720 246 687 332 655 401 640 476 646 541 664 602 665 670 682 744 702 817 722 900 740 1006 780 932 787 804 767 702 751 617 744 511 728 419 731 318 750 234 785 158 822 0 887z"/>
    <path stroke={dawn ? '#89938c' : '#3d5860'} strokeWidth="3" fill="none" d="M231 686 334 650 410 629 475 632 538 650 608 652 675 668 747 688 820 709 900 732 1006 774"/>
    <g>
      <path fill={palette.tower} d="M392 617 405 403H444L460 618z"/>
      <path fill={dawn ? '#bdbcae' : '#526e77'} d="m436 403 8 214h16l-16-214z"/>
      <path fill={palette.roof} d="M397 403H451V392H397zM396 358l28-20 29 20z"/>
      <path fill={dawn ? '#c6b89b' : '#c0b693'} d="M403 360H446V393H403z"/>
      <path fill={palette.light} d="M409 364H440V386H409z" opacity={dawn ? '.58' : '.95'}/>
      <path stroke={palette.roof} strokeWidth="4" d="M413 358V392M436 358V392"/>
      <path fill={palette.roof} d="M414 560h17v57h-17zM416 452h13v28h-13zM416 505h13v24h-13z"/>
      <path fill={dawn ? '#b4afa0' : '#58737b'} d="M370 616h113v14H370z"/>
    </g>
    {!dawn && <>
      <path className="harbor-beam" fill={`url(#${prefix}-beam)`} d="M429 373 1200 255 1200 472z"/>
      <circle cx="424" cy="374" r="3" fill="#fff4d5"/>
    </>}
    <g className="harbor-reflections" stroke={palette.light} strokeLinecap="round" fill="none" opacity={dawn ? '.35' : '.25'}>
      {[0,1,2,3,4,5,6,7,8,9].map(i=><path key={i} d={`M${417-i*7+(i%2)*12} ${644+i*15}h${18+i*11}`} strokeWidth={i<4?2:3}/>) }
      <path d="M589 548h14m-16 11h17m110-13h6m-15 10h20m-549-10h9m-5 8h10m747-6h14m-17 13h22" strokeWidth="2"/>
    </g>
    <g stroke={dawn ? '#c1d0ce' : '#547a88'} fill="none" opacity={dawn ? '.35' : '.17'} strokeLinecap="round">
      <path d="M67 590h81m61-16h43m350 26h86m44-28h67m205 48h91m-739 9h51m-321 33h58m624 170h98m-797 61h127m192-73h74m-21 97h139m157-46h86m-591 33h69m783-128h98m-111-38h49"/>
    </g>
    {dawn && <g>
      <path stroke="#e5dfc9" strokeWidth="3" fill="none" opacity=".7" d="M899 796q-52 30-139 61m142-54q-51 39-124 72"/>
      <path fill="#f0dfbd" d="m881 784 48-9-15 22-19 1z"/>
      <path fill="#314d62" d="m881 784 48-9-5 10-30 9z"/>
      <path stroke="#314d62" strokeWidth="3" d="m903 778-1-32"/>
      <path fill="#e8e2d0" d="m902 746-20 31 20-2z"/>
      <path fill="#d6d0bf" d="m906 750 13 23-13 2z"/>
    </g>}
    {!dawn && <g fill="#bec4bb" opacity=".5"><circle cx="155" cy="176" r="1"/><circle cx="613" cy="233" r="1"/><circle cx="294" cy="117" r=".8"/><circle cx="752" cy="161" r=".8"/><circle cx="1008" cy="126" r="1"/></g>}
  </>;
  return <div className="harbor-scene" aria-hidden="true">
    <svg className="harbor-desktop" viewBox="0 0 1400 1000" preserveAspectRatio="xMidYMid slice">{geometry(`${id}-desktop`)}</svg>
    <svg className="harbor-mobile" viewBox="100 300 1200 500" preserveAspectRatio="xMidYMid slice">{geometry(`${id}-mobile`)}</svg>
  </div>;
}
