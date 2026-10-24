// Material Symbols (https://m3.material.io/styles/icons/overview) as drop-in icon components.
import Box from '@mui/material/Box';

const SIZES = { small: '1.25rem', medium: '1.5rem', large: '2.1875rem', inherit: 'inherit' };

function symbol(name, filled = false) {
  return function SymbolIcon({ fontSize = 'medium', color, sx, className, ...props }) {
    return (
      <Box
        component="span"
        aria-hidden="true"
        {...props}
        className={['material-symbols-outlined', className].filter(Boolean).join(' ')}
        sx={{
          fontSize: SIZES[fontSize],
          color: color ? `${color}.main` : undefined,
          fontVariationSettings: `'FILL' ${filled ? 1 : 0}`,
          userSelect: 'none',
          ...sx,
        }}
      >
        {name}
      </Box>
    );
  };
}

export const ArrowBackIcon = symbol('arrow_back');
export const BookmarkBorderIcon = symbol('bookmark');
export const CheckCircleIcon = symbol('check_circle', true);
export const CheckIcon = symbol('check');
export const CloseIcon = symbol('close');
export const CloudUploadIcon = symbol('cloud_upload');
export const ContentCopyIcon = symbol('content_copy');
export const DeleteIcon = symbol('delete');
export const DirectionsBusFilledIcon = symbol('directions_bus', true);
export const DirectionsBusIcon = symbol('directions_bus');
export const DragHandleIcon = symbol('drag_handle');
export const DrawIcon = symbol('draw');
export const EditIcon = symbol('edit');
export const EmailIcon = symbol('mail');
export const ErrorIcon = symbol('error', true);
export const LayersClearIcon = symbol('layers_clear');
export const ListAltIcon = symbol('list_alt');
export const LogoutIcon = symbol('logout');
export const MapIcon = symbol('map');
export const PersonIcon = symbol('person');
export const RedoIcon = symbol('redo');
export const RestaurantMenuIcon = symbol('restaurant_menu');
export const SaveIcon = symbol('save');
export const ScheduleIcon = symbol('schedule');
export const SearchIcon = symbol('search');
export const StarIcon = symbol('star', true);
export const StraightenIcon = symbol('straighten');
export const UndoIcon = symbol('undo');
export const VisibilityIcon = symbol('visibility');
export const VisibilityOffIcon = symbol('visibility_off');
export const ExpandMoreIcon = symbol('expand_more');
export const InfoIcon = symbol('info', true);
export const WarningIcon = symbol('warning', true);
export const TripOriginIcon = symbol('trip_origin');
export const LocationOnIcon = symbol('location_on', true);
